#!/usr/bin/env node
// Additive installer for the team setup. It never replaces anything you already have:
// - skills: copies only the ones you don't have (same name = yours, left alone)
// - CLAUDE.md: adds one marked block; your own rules outside it are never touched
// - settings.json: adds only missing keys and hooks; your values always win
// - plugins and skill packs: installs only what is missing
// Every file it changes is backed up first as <file>.bak-<time>.
//
//   node setup/install.mjs [--dry-run] [--no-plugins] [--no-packs]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOME = os.homedir()
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude')
const SKILLS = path.join(CLAUDE, 'skills')
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const slash = p => p.replace(/\\/g, '/')
const readJson = (f, dflt) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : dflt
const tryJson = (f, dflt) => { try { return readJson(f, dflt) ?? dflt } catch { return dflt } } // for files we only read
const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
export const BEGIN = '<!-- team-setup:begin (added by whatsapp-voice-notes/setup/install.mjs; your own rules go outside this block) -->'
export const END = '<!-- team-setup:end -->'
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

function save(file, text) {
  if (DRY) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${stamp}`)
  fs.writeFileSync(file, text)
}

// ---- pure helpers (tested in install.test.mjs) ----

const count = (s, sub) => s.split(sub).length - 1

// Adds the block, or refreshes it in place if an older copy is there. Nothing outside the markers changes.
// Returns null when the markers were edited by hand (one missing or doubled): then we touch nothing.
export function upsertBlock(text, body) {
  const block = `${BEGIN}\n${body.trim()}\n${END}`
  const nb = count(text, BEGIN), ne = count(text, END)
  if (nb === 0 && ne === 0) return text ? `${text.replace(/\s*$/, '')}\n\n${block}\n` : `${block}\n`
  const a = text.indexOf(BEGIN), b = text.indexOf(END)
  if (nb !== 1 || ne !== 1 || b < a) return null
  return text.slice(0, a) + block + text.slice(b + END.length)
}

const hookKey = h => JSON.stringify([h.command, (h.args || []).map(a => String(a).replace(/\\/g, '/').toLowerCase())])

// Adds what is missing from `add` into `mine`. Existing values (including `false`) are never changed,
// and a key with an unexpected shape is skipped rather than "fixed".
export function mergeSettings(mine, add) {
  const out = structuredClone(mine)
  const added = []
  for (const [k, v] of Object.entries(add)) {
    if (k.startsWith('_')) continue
    if (k === 'hooks') {
      out.hooks ??= {}
      if (!isObj(out.hooks)) continue
      for (const [event, groups] of Object.entries(v)) {
        out.hooks[event] ??= []
        if (!Array.isArray(out.hooks[event])) continue
        const have = new Set(out.hooks[event].flatMap(g => (isObj(g) && Array.isArray(g.hooks) ? g.hooks : [])).map(hookKey))
        const fresh = groups.flatMap(g => g.hooks).filter(h => !have.has(hookKey(h)))
        if (fresh.length) { out.hooks[event].push({ hooks: fresh }); added.push(`hooks.${event} (${fresh.length})`) }
        else if (!out.hooks[event].length) delete out.hooks[event]
      }
    } else if (isObj(v)) {
      out[k] ??= {}
      if (!isObj(out[k])) continue
      for (const [kk, vv] of Object.entries(v)) if (!(kk in out[k])) { out[k][kk] = vv; added.push(`${k}.${kk}`) }
    } else if (!(k in out)) { out[k] = v; added.push(k) }
  }
  return { settings: out, added }
}

// ---- steps ----

function skills() {
  const mine = []
  for (const name of fs.readdirSync(path.join(HERE, 'skills')).filter(n => fs.statSync(path.join(HERE, 'skills', n)).isDirectory())) {
    const dest = path.join(SKILLS, name)
    if (fs.existsSync(dest)) { console.log(`  skip skill ${name} (you already have one by that name)`); continue }
    mine.push(name)
    if (DRY) continue
    fs.cpSync(path.join(HERE, 'skills', name), dest, { recursive: true })
  }
  // obsidian-wiki needs per-machine config files; make them from the examples
  const scripts = path.join(SKILLS, 'obsidian-wiki', 'scripts')
  if (mine.includes('obsidian-wiki') && !DRY) for (const ex of fs.readdirSync(scripts).filter(f => f.endsWith('.example.json'))) {
    const real = path.join(scripts, ex.replace('.example', ''))
    if (!fs.existsSync(real)) fs.writeFileSync(real, fs.readFileSync(path.join(scripts, ex), 'utf8')
      .replaceAll('{HOME}', slash(HOME)).replaceAll('{TEMP}', slash(os.tmpdir())))
  }
  console.log(mine.length ? `  added skills: ${mine.join(', ')}` : '  no new skills')
}

function rules() {
  const file = path.join(CLAUDE, 'CLAUDE.md')
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const after = upsertBlock(before, fs.readFileSync(path.join(HERE, 'CLAUDE.md'), 'utf8'))
  if (after === null) return console.log('  CLAUDE.md: the team-setup markers were edited by hand (one is missing or doubled); left the file alone')
  if (after === before) return console.log('  CLAUDE.md already has the current team block')
  save(file, after)
  console.log(`  CLAUDE.md: ${before.includes(BEGIN) ? 'refreshed' : 'added'} the team block (your own rules are untouched)`)
}

function settings() {
  const file = path.join(CLAUDE, 'settings.json')
  let mine
  try { mine = readJson(file, {}) } catch { mine = null }
  if (!isObj(mine)) return console.log(`  settings.json is not a valid JSON object; left it alone. Fix it and run again.`)
  const add = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.additions.json'), 'utf8').replaceAll('{SKILLS}', slash(SKILLS)))
  // only wire hooks whose script exists (the obsidian-wiki skill may be your own, different one);
  // in a dry run the skills were not copied, so look for them here instead
  const exists = p => fs.existsSync(p) || (DRY && fs.existsSync(path.join(HERE, 'skills', path.relative(SKILLS, p))))
  for (const groups of Object.values(add.hooks)) for (const g of groups) g.hooks = g.hooks.filter(h => exists(h.args[0]))
  const { settings: merged, added } = mergeSettings(mine, add)
  if (!added.length) return console.log('  settings.json already has everything')
  save(file, JSON.stringify(merged, null, 2) + '\n')
  console.log(`  settings.json: added ${added.join(', ')}`)
}

const SAFE = /^[\w.@/-]+$/ // names come from our own JSON, but they reach a shell, so check them
function run(cmd) {
  if (!cmd.split(' ').every(w => SAFE.test(w))) throw new Error(`refusing odd command: ${cmd}`)
  console.log(`  $ ${cmd}`)
  if (DRY) return
  try { execSync(cmd, { stdio: 'inherit', windowsHide: true }) } catch { console.log(`  (that failed; carrying on. Run it again yourself later.)`) }
}

function plugins() {
  const add = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.additions.json'), 'utf8'))
  const known = tryJson(path.join(CLAUDE, 'plugins', 'known_marketplaces.json'), {})
  const knownRepos = new Set(Object.values(known).map(m => m?.source?.repo?.toLowerCase()))
  const installed = tryJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), {}).plugins || {}
  const enabled = tryJson(path.join(CLAUDE, 'settings.json'), {}).enabledPlugins || {}
  try { execSync('claude --version', { stdio: 'ignore', windowsHide: true }) } catch { return console.log('  claude CLI not found; plugins will be offered when Claude Code next starts') }
  for (const [name, m] of Object.entries(add.extraKnownMarketplaces))
    if (!known[name] && !knownRepos.has(m.source.repo.toLowerCase())) run(`claude plugin marketplace add ${m.source.repo}`)
  for (const id of Object.keys(add.enabledPlugins))
    if (!installed[id] && enabled[id] !== false) run(`claude plugin install ${id}`) // false = you turned it off
}

function packs() {
  const list = readJson(path.join(HERE, 'skill-packs.json'), {})
  for (const [repo, names] of Object.entries(list)) {
    const missing = names.filter(n => !fs.existsSync(path.join(SKILLS, n)))
    if (missing.length) run(`npx -y skills add ${repo} -g -a claude-code -y -s ${missing.join(' ')}`)
  }
}

function hints() {
  const have = tryJson(path.join(process.env.CLAUDE_CONFIG_DIR || HOME, '.claude.json'), {}).mcpServers || {}
  const servers = Object.entries(readJson(path.join(HERE, 'mcp-servers.json'), {})).filter(([k]) => !k.startsWith('_') && !have[k])
  if (servers.length) {
    console.log('\nMCP servers to add yourself. Replace each <...> with your own value first:')
    const q = s => (/[\s<>]/.test(s) ? `"${s}"` : s)
    for (const [name, s] of servers) {
      const env = Object.entries(s.env).map(([k, v]) => ` -e ${q(`${k}=${v}`)}`).join('')
      console.log(`  npm i -g ${s.npm} && claude mcp add -s user ${name}${env} -- ${[s.command, ...s.args].map(q).join(' ')}`)
    }
  }
  if (!process.env.LMSTUDIO_API_KEY) console.log('\nSet LMSTUDIO_API_KEY (your OmniRoute gateway key) as a user environment variable. See setup/.env.example.')
  if (process.platform === 'win32') console.log('Free models need OmniRoute: npm i -g omniroute, then run setup/omniroute/omniroute.vbs (hidden, no window). Copy it into shell:startup to start it at sign-in.')
  else console.log('Free models need OmniRoute running: npm i -g omniroute && omniroute serve --daemon --no-open')
}

const MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (MAIN) {
  console.log(`Team setup -> ${CLAUDE}${DRY ? '  (dry run: nothing is changed)' : ''}`)
  skills(); rules(); settings()
  if (!argv.includes('--no-plugins')) plugins()
  if (!argv.includes('--no-packs')) packs()
  hints()
  console.log('\nDone. Restart Claude Code to load the new skills, rules and hooks.')
}
