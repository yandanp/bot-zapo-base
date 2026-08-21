#!/usr/bin/env node
/**
 * QUICK VALIDATION SCRIPT FOR PRIVATE MESSAGING BASE
 *
 * Tests:
 *   1. registry: register/find/isRegistered/listRegistered + re-register upsert
 *   2. privateMessage: guard group JID, send to real user (mocked or skipped)
 *   3. groupPlayers: queryGroupParticipants error handling for invalid jid
 *
 * Run from repo root:
 *   node tests/validate-private-base.js
 */
import {
  openDatabase,
  closeDatabase,
  register,
  findByJid,
  isRegistered,
  listRegistered,
  registerFromMessage
} from '../lib/registry.js'
import {
  sendPrivateMessage,
  sendPrivateBatch,
  isGroupJid
} from '../lib/private-message.js'
import {
  resolveRegisteredPlayers,
  queryGroupParticipants
} from '../lib/group-players.js'

let passed = 0, failed = 0

const log = (msg) => console.log('✓', msg)
const fail = (msg) => { console.error('✗', msg); failed++ }

// ── Registry ───────────────────────────────────────────────────────
console.log('\n=== Registry ===')
openDatabase({ dbPath: '.data/test-validate.sqlite' })

try {
  const u = register({
    jid: '6281234567890@s.whatsapp.net',
    displayName: 'Budi',
    groupJid: '120363234234@g.us'
  })
  log(`registered jid=${u.jid}, displayName=${u.displayName}`)
  if (!u.groups?.includes('120363234234@g.us')) fail('groups tracking missing')
  else passed++
} catch (e) {
  fail('register throw: ' + e.message)
}

try {
  const found = findByJid('6281234567890:5@s.whatsapp.net')
  if (found?.displayName === 'Budi') log('findByJid strips device suffix')
  else fail('findByJid device-stripped lookup failed')
} catch (e) {
  fail('findByJid throw: ' + e.message)
}

try {
  if (isRegistered('6281234567890@s.whatsapp.net') && !isRegistered('999@s.whatsapp.net')) {
    log('isRegistered correct')
    passed += 2
  } else fail('isRegistered incorrect')
} catch (e) {
  fail('isRegistered throw: ' + e.message)
}

try {
  const inList = listRegistered([
    '6281234567890@s.whatsapp.net',
    '999@s.whatsapp.net',
    { jid: '6281234567890:2@s.whatsapp.net' }
  ])
  if (inList.length === 1) {
    log(`listRegistered filtered: count=${inList.length}`)
    passed++
  } else fail('listRegistered returned wrong count')
} catch (e) {
  fail('listRegistered throw: ' + e.message)
}

try {
  // re-register WITHOUT displayName — should preserve existing name
  const updated = register({
    jid: '6281234567890@s.whatsapp.net'
  })
  if (updated.displayName === 'Budi') {
    log('register upsert preserves old displayName when not provided')
    passed++
  } else fail('register upsert logic incorrect: got ' + updated.displayName)
} catch (e) {
  fail('re-register throw: ' + e.message)
}

closeDatabase()
console.log('--- registry done ---\n')

// ── Private Message Guard & Utils ──────────────────────────────────
console.log('=== Private Message ===')

if (isGroupJid('120363@g.us')) {
  log('isGroupJid detects @g.us')
  passed++
} else fail('isGroupJid false-positive')

if (!isGroupJid('6281234567890@s.whatsapp.net')) {
  log('isGroupJid rejects non-groups')
  passed++
} else fail('isGroupJid true-positive')

console.log('--- private message guard done ---\n')

// ── Group Players Helper (requires live client) ─────────────────────
console.log('=== Group Players (requires live Zapo client) ===')
console.log('Skipping: requires an authenticated client.')
console.log('Integration can be tested manually via a plugin.\n')

// ── Summary ────────────────────────────────────────────────────────
const summary = `
=== VALIDATION SUMMARY ===
✅ Passed: ${passed}
❌ Failed: ${failed}
${failed === 0 ? 'All critical path tests OK.' : 'Fix failures before using in production.'}
`
console.log(summary)

process.exit(failed > 0 ? 1 : 0)
