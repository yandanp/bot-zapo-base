/**
 * REGISTRY — global, persistent user registry for the bot.
 *
 * A separate SQLite database (`.data/bot.sqlite` by default) keeps bot-owned
 * data (registered users, and later profiles / stats / game state) isolated
 * from zapo's own auth store (`.auth/state.sqlite`). Never touch zapo's store
 * for bot data.
 *
 * Registration is GLOBAL: a user who registers in Group A is also considered
 * registered when using the bot in Group B. The `groups` column only tracks
 * which groups a user has interacted from — it does not scope membership.
 *
 * Schema mirrors a Baileys-style `contacts` table but bot-owned:
 *   users(
 *     jid          TEXT PRIMARY KEY,   -- normalized PN JID (…@s.whatsapp.net)
 *     lid          TEXT,                -- LID alt-address if known
 *     display_name TEXT,                -- push name / notify name
 *     phone        TEXT,                -- e164 phone if derivable
 *     groups       TEXT,                -- CSV of group JIDs the user has interacted from
 *     created_at   INTEGER,            -- ms epoch
 *     updated_at   INTEGER              -- ms epoch
 *   )
 *
 * Addressing: WhatsApp groups may address members by LID or by PN. The
 * registry keys on the PN form and records the LID alongside it; private
 * messaging prefers the PN form.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

let db = null

/**
 * Resolve and ensure the bot database file exists, then open it.
 * Idempotent — returns the cached connection on subsequent calls.
 *
 * @param {object}  [options]
 * @param {string}  [options.dbPath] Override the DB path (else BOT_DB / .data/bot.sqlite).
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(options = {}) {
  if (db) return db

  const dbPath = resolve(
    process.cwd(),
    options.dbPath ?? process.env.BOT_DB ?? '.data/bot.sqlite'
  )
  mkdirSync(dirname(dbPath), { recursive: true })

  db = new Database(dbPath)
  // Good SQLite hygiene for a single-process bot: WAL lets reads not block the
  // write-behind persistence queue, and a bigger cache keeps hot lookups in RAM.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000') // ~64MB

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      jid          TEXT PRIMARY KEY,
      lid          TEXT,
      display_name TEXT,
      phone        TEXT,
      groups       TEXT DEFAULT '',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
    CREATE INDEX IF NOT EXISTS idx_users_lid ON users (lid);
  `)

  return db
}

/**
 * Close the database. Safe to call on shutdown.
 */
export function closeDatabase() {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * Normalize a JID to its PN form (…@s.whatsapp.net) when possible.
 * LID-only JIDs (…@lid) are returned as-is — the registry stores them too,
 * but private messaging should prefer the PN form when available.
 *
 * @param {string} jid
 * @returns {string}
 */
/**
 * Normalize a JID to its bare (device-stripped) form, preserving its
 * addressing type (PN → @s.whatsapp.net, LID → @lid). Group JIDs are returned
 * as-is so they can still be tracked in the `groups` column.
 *
 * @param {string} jid
 * @returns {string}
 */
function normalizeJid(jid) {
  if (!jid) return ''
  const bare = jid.split('@')[0].split(':')[0]
  if (jid.includes('@g.us')) return `${bare}@g.us`
  if (jid.includes('@lid')) return `${bare}@lid`
  return `${bare}@s.whatsapp.net`
}

/**
 * Register (or upsert) a user globally.
 *
 * @param {object} input
 * @param {string} input.jid          Sender JID (PN or LID).
 * @param {string} [input.lid]        LID alt-address, if known.
 * @param {string} [input.displayName] push/notify name.
 * @param {string} [input.phone]      E.164 phone, if derivable.
 * @param {string} [input.groupJid]   Group the registration came from (tracking only).
 * @returns {{jid:string, lid:string|null, displayName:string|null, phone:string|null, groups:string[], createdAt:number, updatedAt:number}}
 */
export function register(input) {
  const database = openDatabase()
  const now = Date.now()
  const jid = normalizeJid(input.jid)
  if (!jid) throw new Error('register: jid is required')

  const existing = database
    .prepare('SELECT groups FROM users WHERE jid = ?')
    .get(jid) || { groups: '' }

  const groupSet = new Set(
    existing.groups ? existing.groups.split(',').filter(Boolean) : []
  )
  if (input.groupJid) groupSet.add(normalizeJid(input.groupJid))
  const groups = [...groupSet].join(',')

  const row = {
    jid,
    lid: input.lid ?? null,
    display_name: input.displayName ?? null,
    phone: input.phone ?? null,
    groups,
    created_at: now,
    updated_at: now
  }

  database
    .prepare(
      `INSERT INTO users (jid, lid, display_name, phone, groups, created_at, updated_at)
       VALUES (@jid, @lid, @display_name, @phone, @groups, @created_at, @updated_at)
       ON CONFLICT(jid) DO UPDATE SET
         lid = COALESCE(excluded.lid, lid),
         display_name = COALESCE(excluded.display_name, display_name),
         phone = COALESCE(excluded.phone, phone),
         groups = excluded.groups,
         updated_at = excluded.updated_at`
    )
    .run(row)

  return findByJid(jid)
}

/**
 * Look up a single registered user by JID.
 *
 * @param {string} jid
 * @returns {object|null}
 */
export function findByJid(jid) {
  const database = openDatabase()
  const normalized = normalizeJid(jid)
  const row = database
    .prepare('SELECT * FROM users WHERE jid = ? OR lid = ?')
    .get(normalized, normalized)
  return row ? rowToUser(row) : null
}

/**
 * Register the sender of a live incoming-message event. In a group, zapo gives
 * both `participant` and `participantAlt`; one may be PN and the other LID.
 * Registration prefers PN as the durable/private destination and stores LID as
 * an alias. For a private chat, `remoteJid` / `remoteJidAlt` are used instead.
 *
 * @param {import('zapo-js').WaIncomingMessageEvent} event
 * @returns {object}
 */
export function registerFromMessage(event) {
  const key = event?.key
  if (!key) throw new Error('registerFromMessage: event.key is required')

  const primary = key.isGroup ? key.participant : key.remoteJid
  const alternate = key.isGroup ? key.participantAlt : key.remoteJidAlt
  const pn = [primary, alternate].find((jid) => jid?.includes('@s.whatsapp.net'))
  const lid = [primary, alternate].find((jid) => jid?.includes('@lid'))

  if (!pn) {
    throw new Error(
      'registerFromMessage: PN-form sender JID is unavailable; wait for a message event with participantAlt/remoteJidAlt'
    )
  }

  return register({
    jid: pn,
    lid,
    displayName: event.pushName,
    phone: pn.split('@')[0].split(':')[0],
    groupJid: key.isGroup ? key.remoteJid : undefined
  })
}

/**
 * Return the subset of `participants` that are registered.
 * Accepts an array of JIDs or { jid } objects (e.g. group participants).
 *
 * @param {readonly (string|{jid:string})[]} participants
 * @returns {object[]} registered users
 */
export function listRegistered(participants) {
  const database = openDatabase()
  const jids = participants
    .map((p) => normalizeJid(typeof p === 'string' ? p : p?.jid))
    .filter(Boolean)
  if (jids.length === 0) return []

  const placeholders = jids.map(() => '?').join(',')
  const rows = database
    .prepare(`SELECT * FROM users WHERE jid IN (${placeholders})`)
    .all(...jids)
  return rows.map(rowToUser)
}

/**
 * True when `jid` is a registered user.
 *
 * @param {string} jid
 * @returns {boolean}
 */
export function isRegistered(jid) {
  return findByJid(jid) !== null
}

function rowToUser(row) {
  return {
    jid: row.jid,
    lid: row.lid ?? null,
    displayName: row.display_name ?? null,
    phone: row.phone ?? null,
    groups: row.groups ? row.groups.split(',').filter(Boolean) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
