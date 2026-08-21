/**
 * GROUP PLAYERS — bridge between group membership and the global registry.
 *
 * A command can start in a group while its private output is delivered only
 * to registered group members. This module fetches the complete group roster,
 * resolves PN/LID addresses, and intersects it with the global registry.
 * It contains NO game-specific logic.
 */
import { findByJid } from './registry.js'

/**
 * Fetch the complete roster for a WhatsApp group.
 *
 * @param {object} deps
 * @param {import('zapo-js').WaClient} deps.client
 * @param {string} deps.groupJid
 * @returns {Promise<readonly object[]>}
 */
export async function queryGroupParticipants({ client, groupJid }) {
  if (!groupJid?.endsWith('@g.us')) {
    throw new Error(`queryGroupParticipants: ${groupJid || '<empty>'} is not a group JID`)
  }
  const metadata = await client.group.queryGroupMetadata(groupJid)
  return metadata.participants
}

/**
 * Resolve one group participant against the global registry. Group metadata
 * may expose PN as `phoneNumber`, `jid`, or only through a registered LID alias.
 *
 * @param {object} participant
 * @returns {object|null}
 */
export function findRegisteredParticipant(participant) {
  const candidates = [participant?.phoneNumber, participant?.jid, participant?.lid]
    .filter(Boolean)
  for (const jid of candidates) {
    const user = findByJid(jid)
    if (user) return user
  }
  return null
}

/**
 * Fetch group metadata and return registered participants that have a private
 * destination. Unregistered members are skipped.
 *
 * @param {object} deps
 * @param {import('zapo-js').WaClient} deps.client
 * @param {string} deps.groupJid
 * @param {object} [deps.options]
 * @param {boolean} [deps.options.adminsOnly] Restrict to admins (default false).
 * @returns {Promise<object[]>}
 */
export async function resolveRegisteredPlayers({ client, groupJid, options = {} }) {
  const participants = await queryGroupParticipants({ client, groupJid })
  const seen = new Set()
  const users = []

  for (const participant of participants) {
    if (options.adminsOnly && !participant.isAdmin) continue
    const user = findRegisteredParticipant(participant)
    if (!user || seen.has(user.jid)) continue
    seen.add(user.jid)
    users.push({
      ...user,
      privateJid: user.jid,
      groupParticipant: participant
    })
  }

  return users
}
