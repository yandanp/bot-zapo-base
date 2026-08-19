/**
 * bot-zapo entry point.
 *
 * Wire-up order:
 *   1. logger
 *   2. socket  → WaClient built over the persistent (upsert) store
 *   3. pairing observability handlers (QR renderer / pairing-code / paired)
 *   4. reconnect supervisor attached before connect() so close events fire
 *      on a supervisor that's already listening
 *   5. plugins loaded (ping, and any future plugins dropped into src/plugins/)
 *   6. connect() — QR flow by default, or link-code flow if PAIRING_PHONE set
 */
import 'dotenv/config'
import qrcode from 'qrcode-terminal'
import { createLogger } from './logger.js'
import { createSocket } from './socket.js'
import { attachReconnect } from './reconnect.js'
import { loadPlugins } from './plugins/loader.js'

async function main() {
  const logger = await createLogger()
  const client = createSocket({ logger })

  // ── Pairing / connection observability ──────────────────────────
  client.on('connection', (event) => {
    logger.info({ status: event.status, reason: event.reason }, 'connection event')
  })

  client.on('auth_qr', ({ qr, ttlMs }) => {
    // Render the pairing QR as an ASCII matrix that can actually be scanned.
    console.log('\n────────────── scan this QR ──────────────')
    qrcode.generate(qr, { small: true }, (ascii) => {
      console.log(ascii)
    })
    console.log(`expires in ${(ttlMs / 1000).toFixed(0)}s — a new QR will appear if it times out`)
    console.log('──────────────────────────────────────────\n')
  })

  client.on('auth_pairing_code', ({ code }) => {
    logger.info({ code }, 'pairing code — enter it on the phone')
  })

  client.on('auth_paired', ({ credentials }) => {
    logger.info({ meJid: credentials.meJid }, 'paired successfully')
  })

  // ── Reconnect supervisor (attach BEFORE connect) ────────────────
  const reconnect = attachReconnect({
    client,
    logger,
    delayMs: Number(process.env.RECONNECT_DELAY_MS ?? 2_000),
    maxAttempts: Number(process.env.RECONNECT_MAX_ATTEMPTS ?? 0),
    onGiveUp: () => process.exit(1)
  })

  // ── Plugins ─────────────────────────────────────────────────────
  const loaded = await loadPlugins({
    client,
    logger,
    config: { prefix: '!' }
  })
  logger.info({ loaded }, 'plugins ready')

  // ── Graceful shutdown ───────────────────────────────────────────
  const shutdown = async (code = 0) => {
    reconnect.stop()
    await client.disconnect().catch(() => undefined)
    process.exit(code)
  }
  process.on('SIGINT', () => void shutdown(0))
  process.on('SIGTERM', () => void shutdown(0))

  // ── Connect: QR flow (default) or link-code flow ────────────────
  const pairingPhone = process.env.PAIRING_PHONE?.trim()
  try {
    if (pairingPhone) {
      // Link-code flow: fire connect() without awaiting, wait for the
      // server to signal it's ready, then request the 8-digit code.
      logger.info({ phone: pairingPhone }, 'link-mode: pairing-code flow')
      const connectPromise = client.connect()
      await new Promise((resolve) => client.once('auth_pairing_required', resolve))
      const code = await client.auth.requestPairingCode(pairingPhone)
      logger.info(
        { code },
        'link-code: enter this 8-digit code on your phone (Settings → Linked devices → Link with phone number)'
      )
      await connectPromise
    } else {
      // QR flow (default).
      await client.connect()
    }
    logger.info('bot started — waiting for messages')
  } catch (error) {
    logger.error({ message: error?.message }, 'initial connect failed')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
