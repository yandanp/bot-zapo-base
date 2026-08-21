/**
 * PING PLUGIN.
 *
 * Replies `pong` whenever the bot receives the command `ping` (or a message
 * starting with the configured prefix + ping). This is the canonical "hello
 * world" of a WhatsApp bot and doubles as a latency check.
 */
export default function pingPlugin(ctx) {
  const { client, logger, config } = ctx
  const prefix = config.prefix ?? '!'

  client.on('message', async (event) => {
    // Ignore messages we sent ourselves and messages with no key/jid.
    if (event.key?.fromMe) return
    const to = event.key?.remoteJid
    if (!to) return

    const text = extractText(event.message)
    if (!text) return

    const command = text.trim().toLowerCase()
    const isPing = command === 'ping' || command === `${prefix}ping`
    if (!isPing) return

    const nowSeconds = Date.now() / 1_000
    const delta =
      event.timestampSeconds === undefined ? 0 : nowSeconds - event.timestampSeconds

    try {
      await client.message.send(
        to,
        {
          type: 'text',
          text: `pong 🏓\nlatency: ${delta.toFixed(3)}s`
        },
        {
          // Quote the command event directly from memory. This still works
          // when STORE_MESSAGES=none because no database lookup is needed.
          quote: event
        }
      )
      logger.debug({ from: to, delta }, 'ping → pong')
    } catch (error) {
      logger.error({ to, message: error?.message }, 'failed to send pong')
    }
  })
}

/**
 * Pull plain text out of an incoming Proto.IMessage.
 * @param {object|undefined} message
 * @returns {string|undefined}
 */
function extractText(message) {
  if (!message) return undefined
  if (typeof message.conversation === 'string' && message.conversation.length > 0) {
    return message.conversation
  }
  const extended = message.extendedTextMessage?.text
  if (typeof extended === 'string' && extended.length > 0) {
    return extended
  }
  return undefined
}
