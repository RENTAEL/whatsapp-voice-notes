// node --test   (index + selection logic; no WhatsApp connection needed)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toEntry, remember, pick } from './bridge.mjs'

let n = 0
const msg = (o = {}) => ({
  key: { remoteJid: o.jid ?? '27820000001@s.whatsapp.net', fromMe: o.fromMe ?? false, id: o.id ?? 'ID' + n++, participant: o.participant },
  pushName: o.name ?? 'Jabu',
  messageTimestamp: o.ts ?? 1000 + n,
  message: o.message ?? { audioMessage: { seconds: 20, viewOnce: o.viewOnce } },
})

test('received voice note becomes an entry with number', () => {
  const e = toEntry(msg())
  assert.equal(e.from, 'Jabu')
  assert.equal(e.number, '27820000001')
})
test('own, text, view-once, status and newsletter are ignored', () => {
  assert.equal(toEntry(msg({ fromMe: true })), null)
  assert.equal(toEntry(msg({ message: { conversation: 'hi' } })), null)
  assert.equal(toEntry(msg({ viewOnce: true })), null)
  assert.equal(toEntry(msg({ jid: 'status@broadcast' })), null)
  assert.equal(toEntry(msg({ jid: '123@newsletter' })), null)
})
test('ephemeral wrapper and Long timestamp work', () => {
  const e = toEntry(msg({ ts: { toNumber: () => 5 }, message: { ephemeralMessage: { message: { audioMessage: { seconds: 3 } } } } }))
  assert.equal(e.time, 5)
})
test('group note uses the participant number; LID numbers are hidden', () => {
  assert.equal(toEntry(msg({ jid: '1-2@g.us', participant: '27831112222@s.whatsapp.net' })).number, '27831112222')
  assert.equal(toEntry(msg({ jid: '999@lid' })).number, '')
})
test('pick: newest first, by name or number, with count', () => {
  const idx = remember({}, [
    msg({ id: 'a', name: 'Jabu', ts: 10 }), msg({ id: 'b', name: 'Pieter', ts: 30, jid: '27839990000@s.whatsapp.net' }),
    msg({ id: 'c', name: 'Jabu', ts: 20 }),
  ])
  assert.deepEqual(pick(idx).map(e => e.id), ['b'])
  assert.deepEqual(pick(idx, { from: 'jabu', count: 5 }).map(e => e.id), ['c', 'a'])
  assert.deepEqual(pick(idx, { from: '+27 83 999' }).map(e => e.id), ['b'])
  assert.deepEqual(pick(idx, { from: 'nobody' }), [])
})
test('re-seen message keeps its downloaded file and name', () => {
  const idx = remember({}, [msg({ id: 'x', name: 'Jabu' })])
  idx.x.file = 'f.ogg'
  remember(idx, [msg({ id: 'x', name: '' })])
  assert.equal(idx.x.file, 'f.ogg')
  assert.equal(idx.x.from, 'Jabu')
})
