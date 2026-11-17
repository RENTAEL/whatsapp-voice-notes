// node --test setup/   (the merge rules that keep the installer additive)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upsertBlock, mergeSettings, BEGIN, END } from './install.mjs'

test('block is appended after the user rules, then refreshed in place', () => {
  const mine = '# My rules\n- be brief\n'
  const once = upsertBlock(mine, 'team v1')
  assert.ok(once.startsWith(mine.trim()))
  assert.ok(once.includes(`${BEGIN}\nteam v1\n${END}`))
  const twice = upsertBlock(once + '\n- added later by me\n', 'team v2')
  assert.ok(twice.includes('team v2') && !twice.includes('team v1'))
  assert.ok(twice.includes('- be brief') && twice.includes('- added later by me'))
  assert.equal(upsertBlock(twice, 'team v2'), twice)
})

test('empty CLAUDE.md gets just the block', () => {
  assert.equal(upsertBlock('', 'x'), `${BEGIN}\nx\n${END}\n`)
})

test('hand-edited markers: file is left alone instead of cutting user text', () => {
  const block = upsertBlock('# mine\n', 'team')
  assert.equal(upsertBlock(block.replace(END, ''), 'team v2'), null)
  assert.equal(upsertBlock(block + block, 'team v2'), null)
  assert.equal(upsertBlock(`${END}\n${BEGIN}\n`, 'x'), null)
})

test('settings: odd shapes are skipped, hooks match across slash styles', () => {
  const add = { env: { A: '1' }, hooks: { Stop: [{ hooks: [{ command: 'node', args: ['C:/u/.claude/skills/x.mjs'] }] }] } }
  const { settings: s } = mergeSettings({ env: 'oops', hooks: { Stop: [{ hooks: [{ command: 'node', args: ['C:\\U\\.claude\\skills\\x.mjs'] }] }] } }, add)
  assert.equal(s.env, 'oops')
  assert.equal(s.hooks.Stop.length, 1)
  assert.equal(mergeSettings({ hooks: { Stop: 'bad' } }, add).settings.hooks.Stop, 'bad')
})

test('settings: only missing keys are added, user values win', () => {
  const mine = { env: { MCP_TIMEOUT: '5' }, enabledPlugins: { 'ponytail@ponytail': false }, theme: 'dark',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['/mine.mjs'] }] }] } }
  const add = { _about: 'x', skillListingBudgetFraction: 0.25, theme: 'light',
    env: { MCP_TIMEOUT: '60000', NEW: '1' }, enabledPlugins: { 'ponytail@ponytail': true, 'ecc@ecc': true },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['/mine.mjs'] }, { type: 'command', command: 'node', args: ['/team.mjs'] }] }] } }
  const { settings: s, added } = mergeSettings(mine, add)
  assert.equal(s.theme, 'dark')
  assert.equal(s.env.MCP_TIMEOUT, '5')
  assert.equal(s.env.NEW, '1')
  assert.equal(s.enabledPlugins['ponytail@ponytail'], false)
  assert.equal(s.enabledPlugins['ecc@ecc'], true)
  assert.equal(s.skillListingBudgetFraction, 0.25)
  assert.equal(s._about, undefined)
  assert.equal(s.hooks.Stop.length, 2)
  assert.deepEqual(s.hooks.Stop[1].hooks.map(h => h.args[0]), ['/team.mjs'])
  assert.equal(mergeSettings(s, add).added.length, 0)
  assert.equal(mine.env.NEW, undefined) // input not mutated
  assert.ok(added.includes('hooks.Stop (1)'))
})
