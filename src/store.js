/**
 * STORE — the "upsert" layer.
 *
 * zapo-js persists everything (credentials, Signal keys, pre-keys, sessions,
 * sender-keys, app-state, privacy tokens, contacts, threads and the message
 * archive) through a store of pluggable backends. The SQLite backend performs
 * UPSERT semantics under the hood: every record write merges into the existing
 * row (INSERT ... ON CONFLICT ... DO UPDATE), so restarting the bot re-uses the
 * already-paired credentials instead of forcing a fresh QR scan.
 *
 * In older libraries (e.g. Baileys) you called `saveCreds()` manually. Here the
 * auth client upserts credentials automatically via `updateCredentials` on every
 * pairing / refresh step — this module just wires that storage up.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createStore } from 'zapo-js'
import { createSqliteStore } from '@zapo-js/store-sqlite'

/**
 * Build a persistent store backed by SQLite.
 *
 * @param {object}  [options]
 * @param {string}  [options.authPath] Absolute or relative path to the SQLite file.
 * @returns {ReturnType<typeof createStore>} The wired store.
 */
export function buildStore(options = {}) {
  const authPath = resolve(
    process.cwd(),
    options.authPath ?? process.env.AUTH_PATH ?? '.auth/state.sqlite'
  )

  // Make sure the parent directory exists before SQLite opens its file handle.
  mkdirSync(dirname(authPath), { recursive: true })

  const backend = createSqliteStore({ path: authPath, driver: 'auto' })

  return createStore({
    backends: {
      sqlite: backend
    },
    providers: {
      // auth → credentials are upserted here on every pairing/refresh.
      auth: 'sqlite',
      signal: 'sqlite',
      preKey: 'sqlite',
      session: 'sqlite',
      identity: 'sqlite',
      senderKey: 'sqlite',
      appState: 'sqlite',
      privacyToken: 'sqlite',
      messages: 'sqlite', // set 'none' to skip the message archive
      threads: 'sqlite', // set 'none' to skip
      contacts: 'sqlite' // set 'none' to skip
    }
  })
}
