#!/usr/bin/env node
// Sends one prompt to the local OmniRoute gateway and prints the reply.
// Fallback for when the omniroute MCP server is not connected.
// Usage: node ask.mjs [--model free] [--system "..."] [--file path ...] "prompt"   (or prompt on stdin)
import fs from 'node:fs';

const args = process.argv.slice(2);
let model = 'free', system = '', files = [], prompt = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model') model = args[++i];
  else if (args[i] === '--system') system = args[++i];
  else if (args[i] === '--file') files.push(args[++i]);
  else prompt.push(args[i]);
}
let text = prompt.join(' ');
if (!text && !process.stdin.isTTY) text = fs.readFileSync(0, 'utf8');
for (const f of files) text += `\n\n--- ${f} ---\n${fs.readFileSync(f, 'utf8')}`;
if (!text.trim()) { console.error('no prompt'); process.exit(2); }

// The gateway key lives in the user env var set up for OpenJarvis; read it from the registry if this shell predates it.
let key = process.env.LMSTUDIO_API_KEY;
if (!key && process.platform === 'win32') {
  const { execFileSync } = await import('node:child_process');
  key = execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('LMSTUDIO_API_KEY','User')"], { windowsHide: true }).toString().trim();
}

const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: text }];
const res = await fetch('http://localhost:20128/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify({ model, messages }),
  signal: AbortSignal.timeout(180000),
}).catch((e) => { console.error(`OmniRoute unreachable (${e.message}). Start it: wscript "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\omniroute.vbs"`); process.exit(1); });
const j = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`error ${res.status}: ${j.error?.message || ''}`.slice(0, 300)); process.exit(1); }
console.log(j.choices?.[0]?.message?.content ?? '');
console.error(`[model: ${j.model}]`);
