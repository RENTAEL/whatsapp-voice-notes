// node --test   (checks who gets an auto-reply; no WhatsApp connection needed)
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { wanted } = await import('./bridge.mjs')
const now = () => Math.floor(Date.now() / 1000)
let n = 0
const msg = (o = {}) => ({
  key: { remoteJid: o.jid ?? `2782000000${n++}@s.whatsapp.net`, fromMe: o.fromMe ?? false, id: 'ABC' + n, participant: o.participant },
  messageTimestamp: o.ts ?? now(),
  message: o.message ?? { audioMessage: { seconds: o.seconds ?? 20, viewOnce: o.viewOnce } },
})
test('direct voice note is processed', () => assert.ok(wanted(msg())))
test('own notes, text, view-once, status are skipped', () => {
  assert.equal(wanted(msg({ fromMe: true })), null)
  assert.equal(wanted(msg({ message: { conversation: 'hi' } })), null)
  assert.equal(wanted(msg({ viewOnce: true })), null)
  assert.equal(wanted(msg({ jid: 'status@broadcast' })), null)
})
test('groups skipped by default', () => assert.equal(wanted(msg({ jid: '123-456@g.us', participant: '27820000001@s.whatsapp.net' })), null))
test('old backlog and over-long notes skipped', () => {
  assert.equal(wanted(msg({ ts: now() - 7200 })), null)
  assert.equal(wanted(msg({ seconds: 31 * 60 })), null)
})
test('Long timestamp object works', () => assert.ok(wanted(msg({ ts: { toNumber: () => now() } }))))
test('flood: second note from same chat within 10s skipped', () => {
  const jid = '27829999999@s.whatsapp.net'
  assert.ok(wanted(msg({ jid })))
  assert.equal(wanted(msg({ jid })), null)
})
test('ephemeral wrapper is unwrapped', () =>
  assert.ok(wanted(msg({ message: { ephemeralMessage: { message: { audioMessage: { seconds: 5 } } } } }))))
