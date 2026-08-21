/**
 * STORE — the "upsert" layer.
 *
 * zapo-js persists credentials, Signal keys, pre-keys, sessions, sender-keys,
 * app-state, privacy tokens, contacts and threads through a store of pluggable
 * backends. Message archiving is optional via STORE_MESSAGES (`none` by
 * default, or `sqlite`). The SQLite backend performs UPSERT semantics under the
 * hood, so restarting the bot re-uses the already-paired credentials instead
 * of forcing a fresh QR scan.
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
  const messagesProvider = resolveMessagesProvider(process.env.STORE_MESSAGES)

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
      messages: messagesProvider,
      threads: 'sqlite', // set 'none' to skip
      contacts: 'sqlite' // set 'none' to skip
    }
  })
}

/**
 * Only allow supported message providers from the environment.
 * Defaults to `none`, so incoming/outgoing messages are processed in real time
 * but are not archived after their event leaves memory.
 *
 * @param {string|undefined} value
 * @returns {'none'|'sqlite'}
 */
function resolveMessagesProvider(value) {
  const provider = value?.trim().toLowerCase() || 'none'
  if (provider === 'none' || provider === 'sqlite') return provider

  throw new Error(`Invalid STORE_MESSAGES="${value}". Use "none" or "sqlite".`)
}
