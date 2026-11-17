#!/usr/bin/env node
// Agent hub keep-alive: starts whatever part of the hub is down, then exits. Task Scheduler runs it every 5 minutes.
// Checks: bridge watcher (lock heartbeat), live view (port 4317), OmniRoute (20128), Ollama (11434).
// Usage: node keepalive.mjs [--dry]   Log: %LOCALAPPDATA%\agent-hub\keepalive.log
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { watcherAlive } from './agent-bridge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGS = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'agent-hub');
fs.mkdirSync(LOGS, { recursive: true });
const dry = process.argv.includes('--dry');
const log = (s) => fs.appendFileSync(path.join(LOGS, 'keepalive.log'), `${new Date().toISOString()} ${s}\n`);

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port, timeout: 3000 });
  s.on('connect', () => { s.destroy(); resolve(true); }).on('error', () => resolve(false)).on('timeout', () => { s.destroy(); resolve(false); });
});

// Detached and hidden, so it outlives this script; output goes to its own log.
function start(name, cmd, args, logFile) {
  if (dry) return console.log(`would start ${name}`);
  const out = logFile ? fs.openSync(path.join(LOGS, logFile), 'a') : 'ignore';
  spawn(cmd, args, { detached: true, windowsHide: true, stdio: ['ignore', out, out] }).unref();
  log(`started ${name}`);
}

const OLLAMA_APP = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
const checks = [
  ['ollama', () => portOpen(11434), () => fs.existsSync(OLLAMA_APP) ? start('ollama', OLLAMA_APP, []) : start('ollama', 'ollama', ['serve'], 'ollama.log')],
  ['omniroute', () => portOpen(20128), () => start('omniroute', 'cmd.exe', ['/c', 'omniroute', 'serve', '--daemon', '--no-open', '--no-tray'], 'omniroute.log')],
  ['bridge', async () => watcherAlive(), () => start('bridge', process.execPath, [path.join(HERE, 'agent-bridge.mjs'), '--watch'], 'bridge.log')],
  ['view', () => portOpen(Number(process.env.HUB_VIEW_PORT || 4317)), () => start('view', process.execPath, [path.join(HERE, '..', 'hub-view', 'server.mjs')], 'view.log')],
  // The team list goes stale (models removed, quotas reset, new Ollama pulls): rebuild it every 6 hours.
  ['team', () => { try { return Date.now() - fs.statSync(path.join(LOGS, 'team.json')).mtimeMs < 6 * 3600 * 1000; } catch { return false; } },
    () => start('team rebuild', process.execPath, [path.join(HERE, 'team.mjs'), '--build'], 'team.log')],
];
for (const [name, up, fix] of checks) {
  const ok = await up();
  if (dry) console.log(`${name}: ${ok ? 'up' : 'down'}`);
  if (!ok) fix();
}
