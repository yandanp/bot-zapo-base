/**
 * SOCKET — the "create socket" step.
 *
 * zapo-js owns the actual WebSocket (noise handshake, frame codec, keep-alive,
 * resume). From the bot's point of view "creating the socket" means building a
 * `WaClient` over the store and calling `client.connect()`. This module wraps
 * that lifecycle so the entry point stays tiny.
 */
import { WaClient } from 'zapo-js'
import { buildStore } from './store.js'

/**
 * @param {object}   deps
 * @param {import('zapo-js').Logger} deps.logger
 * @returns {import('zapo-js').WaClient}
 */
export function createSocket({ logger }) {
  const store = buildStore()

  const client = new WaClient(
    {
      store,
      sessionId: process.env.SESSION_ID ?? 'default',
      connectTimeoutMs: 15_000,
      deviceBrowser: process.env.DEVICE_BROWSER ?? 'Chrome',
      deviceOsDisplayName: process.env.DEVICE_OS ?? 'Windows',
      // Keep recent history so the bot can answer with context right away.
      history: { enabled: true, requireFullSync: false },
      nodeQueryTimeoutMs: 30_000
    },
    logger
  )

  return client
}
