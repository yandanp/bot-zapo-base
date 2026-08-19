/**
 * RECONNECT — handle the socket lifecycle after a `connection: close` event.
 *
 * zapo-js does **not** auto-reconnect. On a server- or transport-initiated close
 * it emits `connection: { status: 'close', reason, isLogout }` and waits for the
 * user to call `client.connect()` again. This module provides a small supervisor
 * that:
 *
 *   1. Skips reconnect when the close was a logout (device unlinked) — the user
 *      must re-pair, retrying would just fail.
 *   2. Backs off with a fixed delay between attempts.
 *   3. Either retries forever or gives up after a configurable max attempts.
 */
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Attach a reconnect supervisor to a WaClient.
 *
 * @param {object}   deps
 * @param {import('zapo-js').WaClient} deps.client
 * @param {import('zapo-js').Logger}   deps.logger
 * @param {number}   [deps.delayMs]        Delay between attempts (default 2000).
 * @param {number}   [deps.maxAttempts]    0 = retry forever (default 0).
 * @param {() => void} [deps.onGiveUp]     Called when maxAttempts is reached.
 * @returns {{ stop: () => void }}
 */
export function attachReconnect({ client, logger, delayMs = 2_000, maxAttempts = 0, onGiveUp }) {
  let stopped = false
  let attempt = 0

  client.on('connection', async (event) => {
    if (event.status !== 'close') return

    if (stopped) {
      logger.debug({ reason: event.reason }, 'connection closed but supervisor stopped')
      return
    }

    // Device unlinked — credentials are invalid; a reconnect would fail-loop.
    if (event.isLogout) {
      logger.warn(
        { reason: event.reason },
        'connection closed as logout (device unlinked) — NOT reconnecting. Re-pair the device.'
      )
      return
    }

    attempt += 1
    if (maxAttempts > 0 && attempt > maxAttempts) {
      logger.error({ attempt, maxAttempts }, 'reconnect: gave up after max attempts')
      onGiveUp?.()
      return
    }

    logger.info(
      { reason: event.reason, code: event.code, attempt, delayMs },
      'connection closed → reconnecting'
    )
    await delay(delayMs)
    if (stopped) return

    try {
      await client.connect()
      attempt = 0 // reset backoff after a successful re-open
      logger.info('reconnect: connection re-opened')
    } catch (error) {
      logger.error(
        { message: error?.message, attempt },
        'reconnect: client.connect() threw, will retry'
      )
      // Re-emit a synthetic close so this same handler loops again.
      client.emit('connection', {
        status: 'close',
        reason: 'client_reconnect_error',
        code: null,
        isLogout: false
      })
    }
  })

  return {
    stop() {
      stopped = true
      logger.debug('reconnect supervisor stopped')
    }
  }
}
