// On-demand WhatsApp access for the voice-notes skill. Nothing runs in the background:
// each command connects as your linked device, does one job, and disconnects.
//
//   node bridge.mjs link                              show a QR code and link WhatsApp (once)
//   node bridge.mjs fetch [--from TEXT] [--count N]   download the newest received voice notes, print JSON
//   node bridge.mjs reply <id> <text-file>            send a text reply quoting voice note <id>
//
// While disconnected, WhatsApp holds new messages for the linked device and delivers them on the next
// connect, so `fetch` sees every voice note received since the previous run.
import makeWASocket, {
  Browsers, BufferJSON, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion,
  isJidNewsletter, isJidStatusBroadcast, normalizeMessageContent, useMultiFileAuthState,
} from 'baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HOME = process.env.VOICE_NOTES_HOME || path.join(os.homedir(), '.whatsapp-voice-notes')
const AUTH = path.join(HOME, 'whatsapp-auth') // the linked-device login: treat like a password
const NOTES = path.join(HOME, 'notes')
const INDEX = path.join(HOME, 'whatsapp-index.json') // received voice notes (also private)
const KEEP = 300
const logger = pino({ level: 'fatal' }) // Baileys is noisy about chat-label sync we don't use
const say = (...a) => console.error('[whatsapp]', ...a) // stderr: stdout is reserved for JSON

// ---- index of received voice notes (pure helpers, tested in bridge.test.mjs) ----
const tsOf = m => Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp) || 0
const digits = jid => (jid || '').split('@')[0].split(':')[0]

export function toEntry(m) {
  const jid = m.key?.remoteJid
  const audio = normalizeMessageContent(m.message)?.audioMessage
  if (!audio || audio.viewOnce || m.key.fromMe || !m.key.id || !jid || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) return null
  const group = jid.endsWith('@g.us')
  const senderJid = group ? (m.key.participantAlt || m.key.participant) : (m.key.remoteJidAlt || jid)
  return {
    id: m.key.id, jid, group, from: m.pushName || '', number: senderJid?.endsWith('@lid') ? '' : digits(senderJid),
    time: tsOf(m), seconds: audio.seconds || 0, msg: m,
  }
}

export function remember(index, messages) {
  for (const m of messages) {
    const e = toEntry(m)
    if (e) index[e.id] = { ...index[e.id], ...e, from: e.from || index[e.id]?.from || '' }
  }
  const ids = Object.keys(index).sort((a, b) => index[b].time - index[a].time)
  for (const id of ids.slice(KEEP)) {
    if (index[id].file) fs.rmSync(index[id].file, { force: true })
    delete index[id]
  }
  return index
}

export function pick(index, { from = '', count = 1 } = {}) {
  const q = from.toLowerCase().replace(/^\+/, '')
  const qDigits = q.replace(/\D/g, '')
  return Object.values(index)
    .filter(e => !q || e.from.toLowerCase().includes(q) || (qDigits && e.number.includes(qDigits)))
    .sort((a, b) => b.time - a.time)
    .slice(0, count)
}

const load = () => {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8'), BufferJSON.reviver) } catch { return {} } // missing or damaged: start fresh
}
const save = index => { // write then rename, so a crash never leaves half a file
  fs.writeFileSync(INDEX + '.tmp', JSON.stringify(index, BufferJSON.replacer))
  fs.renameSync(INDEX + '.tmp', INDEX)
}

// ---- connection ----
async function connect(index, { allowQr = false } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH)
  if (!state.creds.me && !allowQr) {
    say('WhatsApp is not linked yet. Run:  node bridge.mjs link   (or double-click start-whatsapp.bat) and scan the QR code.')
    process.exit(3)
  }
  const version = await fetchLatestBaileysVersion().then(v => v.version, () => undefined) // offline: library default
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WhatsApp did not connect within 90 seconds')), 90_000)
    const sock = makeWASocket({ version, auth: state, logger, browser: Browsers.windows('Voice Notes'), markOnlineOnConnect: false })
    sock.synced = false
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('messaging-history.set', ({ messages }) => remember(index, messages))
    sock.ev.on('messages.upsert', ({ messages }) => remember(index, messages))
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr, receivedPendingNotifications }) => {
      if (qr) {
        say('Scan this with WhatsApp: Settings > Linked devices > Link a device')
        qrcode.generate(qr, { small: true }, q => console.error(q))
      }
      if (receivedPendingNotifications) sock.synced = true
      if (connection === 'open') { clearTimeout(timer); resolve(sock) }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        clearTimeout(timer)
        if (code === DisconnectReason.restartRequired) return connect(index, { allowQr }).then(resolve, reject) // normal right after linking
        if (code === DisconnectReason.loggedOut) fs.rmSync(AUTH, { recursive: true, force: true })
        reject(new Error(code === DisconnectReason.loggedOut
          ? 'WhatsApp unlinked this device. Run "node bridge.mjs link" to link again.'
          : `WhatsApp connection closed (${code ?? lastDisconnect?.error?.message})`))
      }
    })
  })
}

async function settle(sock, maxMs = 25_000) { // wait for messages held while we were offline
  const t = Date.now()
  while (!sock.synced && Date.now() - t < maxMs) await new Promise(r => setTimeout(r, 500))
  await new Promise(r => setTimeout(r, 4000)) // let the last upserts finish decrypting
}

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt }

const LOCK = path.join(HOME, '.lock')

async function main() {
  const [cmd] = process.argv.slice(2)
  fs.mkdirSync(NOTES, { recursive: true })
  try { // two copies on one link would kick each other off and overwrite each other's files
    fs.closeSync(fs.openSync(LOCK, 'wx'))
  } catch {
    if (Date.now() - fs.statSync(LOCK).mtimeMs < 10 * 60_000) throw new Error('Another WhatsApp fetch/reply is running. Try again in a minute.')
    fs.writeFileSync(LOCK, '') // stale lock from a crashed run
  }
  process.on('exit', () => fs.rmSync(LOCK, { force: true }))
  const index = load()
  if (!['link', 'fetch', 'reply'].includes(cmd)) {
    say('Usage: node bridge.mjs link | fetch [--from TEXT] [--count N] | reply <id> <text-file>')
    process.exit(2)
  }
  if (cmd === 'reply') {
    const [, id, textFile] = process.argv.slice(2)
    const e = index[id]
    if (!e || !textFile) throw new Error(`Unknown voice note id "${id}" (run fetch first) or missing text file`)
    const text = fs.readFileSync(textFile, 'utf8').trim()
    if (!text) throw new Error('Reply text file is empty')
    const sock = await connect(index)
    await sock.sendMessage(e.jid, { text }, { quoted: e.msg })
    await new Promise(r => setTimeout(r, 3000)) // sendMessage resolves on write, not on server ack
    say(`Replied in the chat with ${e.from || e.number || e.jid}`)
    return sock.end(undefined)
  }
  const sock = await connect(index, { allowQr: cmd === 'link' })
  say('Connected.')
  await settle(sock)
  save(index)
  if (cmd === 'link') {
    say('Linked. From now on Claude connects only when you ask it to listen to a voice note.')
    return sock.end(undefined)
  }
  const wanted = pick(index, { from: arg('--from', ''), count: Math.max(1, Number(arg('--count', 1)) || 1) })
  const out = []
  for (const e of wanted) {
    try {
      if (!e.file || !fs.existsSync(e.file)) {
        const buf = await downloadMediaMessage(e.msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })
        const stamp = new Date(e.time * 1000).toISOString().replace(/[:T]/g, '-').slice(0, 19)
        e.file = path.join(NOTES, `WhatsApp Ptt ${stamp} ${e.id.replace(/\W/g, '').slice(0, 12)}.ogg`)
        fs.writeFileSync(e.file, buf)
      }
      out.push({ id: e.id, from: e.from, number: e.number, group: e.group, time: new Date(e.time * 1000).toISOString(), seconds: e.seconds, file: e.file })
    } catch (err) {
      out.push({ id: e.id, from: e.from, error: `download failed: ${err.message}` })
    }
  }
  save(index)
  if (!out.length) say(`No received voice notes found${arg('--from') ? ` from "${arg('--from')}"` : ''}. Only notes received after linking can be fetched.`)
  console.log(JSON.stringify(out, null, 1))
  await sock.end(undefined)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().then(() => process.exit(0), e => { say(e.message); process.exit(1) })
