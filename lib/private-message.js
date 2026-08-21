/**
 * PRIVATE MESSAGE — send messages to users' private chats.
 *
 * This is the generic base layer plugins use to deliver private content
 * (cards, secrets, tokens, DMs) from a group command. It does NOT implement
 * any game logic — it only guarantees a safe, throttled delivery to 1:1 chats.
 *
 * Guarantees:
 *   - Never sends to a group JID (…@g.us) by accident.
 *   - Normalizes JIDs before send.
 *   - Batches with bounded concurrency + a small per-send delay to avoid
 *     looking like spam to WhatsApp.
 *   - Returns per-recipient success/failure so the caller can react.
 */
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_CONCURRENCY = 3
const DEFAULT_INTER_SEND_MS = 400

/**
 * Send a single private message.
 *
 * @param {object} deps
 * @param {import('zapo-js').WaClient} deps.client
 * @param {string} deps.to       Recipient JID (PN preferred; LID only as fallback).
 * @param {object} deps.content  WaSendMessageContent (e.g. { type:'text', text:'…' }).
 * @param {object} [deps.options] Optional send options (quote, etc.).
 * @returns {Promise<{ ok:true, result:object } | { ok:false, error:string }>}
 */
export async function sendPrivateMessage({ client, to, content, options }) {
  const jid = normalizeJid(to)
  if (!jid) return { ok: false, error: 'invalid recipient jid' }
  if (isGroupJid(jid)) return { ok: false, error: `refused: ${jid} is a group jid` }

  try {
    const result = await client.message.send(jid, content, options)
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) }
  }
}

/**
 * Send private messages to many recipients in a throttled batch.
 *
 * @param {object} deps
 * @param {import('zapo-js').WaClient} deps.client
 * @param {{ jid:string, content:object, options?:object }[]} deps.recipients
 * @param {number} [deps.concurrency]   Parallel sends (default 3).
 * @param {number} [deps.interSendMs]   Delay between dispatches (default 400ms).
 * @returns {Promise<{ sent: object[], failed: object[] }>}
 */
export async function sendPrivateBatch({
  client,
  recipients,
  concurrency = DEFAULT_CONCURRENCY,
  interSendMs = DEFAULT_INTER_SEND_MS
}) {
  const sent = []
  const failed = []

  // Simple concurrency limiter: slice into lanes.
  const lanes = Math.max(1, Math.min(concurrency, recipients.length))
  const lanesData = Array.from({ length: lanes }, () => [])

  recipients.forEach((r, i) => lanesData[i % lanes].push(r))

  await Promise.all(
    lanesData.map(async (lane) => {
      for (const { jid, content, options } of lane) {
        const res = await sendPrivateMessage({ client, to: jid, content, options })
        if (res.ok) sent.push({ jid, result: res.result })
        else failed.push({ jid, error: res.error })
        if (interSendMs > 0) await delay(interSendMs)
      }
    })
  )

  return { sent, failed }
}

/**
 * Normalize a recipient JID to PN form when possible.
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

export { isGroupJid }

/**
 * @param {string} jid
 * @returns {boolean}
 */
function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us')
}
