#!/usr/bin/env node
// Asks a free OmniRoute model to draft code, and saves each file it returns into a staging folder.
// Nothing is run and the project is never touched: Claude reviews the staged files, applies them and tests.
// Usage: node draft.mjs --out <staging-folder> [--model free] [--file context.ts ...] "what to build"
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
let out = '', model = 'free', files = [], task = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--model') model = args[++i];
  else if (args[i] === '--file') files.push(args[++i]);
  else task.push(args[i]);
}
let prompt = task.join(' ');
if (!out || !prompt.trim()) { console.error('need --out <staging-folder> and a task'); process.exit(2); }
for (const f of files) prompt += `\n\n--- existing file: ${f} ---\n${fs.readFileSync(f, 'utf8')}`;

const system = [
  'You are a code drafter. Return every file you create or change in full, never as a diff or excerpt.',
  'Put each file in its own fenced code block, and put this line directly above each block: FILE: relative/path.ext',
  'Use relative paths only. After the files, add a short NOTES section: how to run or test it, and any assumptions.',
].join(' ');

let key = process.env.LMSTUDIO_API_KEY;
if (!key && process.platform === 'win32') {
  key = execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('LMSTUDIO_API_KEY','User')"], { windowsHide: true }).toString().trim();
}
const res = await fetch('http://localhost:20128/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  signal: AbortSignal.timeout(300000),
}).catch((e) => { console.error(`OmniRoute unreachable (${e.message})`); process.exit(1); });
const j = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`error ${res.status}: ${j.error?.message || ''}`.slice(0, 300)); process.exit(1); }
const text = j.choices?.[0]?.message?.content ?? '';

// FILE: path, optional blank lines, then a fenced block (``` or ~~~, any info string).
const re = /^\s*\**FILE:\**\s*`?([^\s`*]+)`?\**\s*\n+(```|~~~)[^\n]*\n([\s\S]*?)\n\2[ \t]*$/gm;
const root = path.resolve(out);
fs.mkdirSync(root, { recursive: true });
const saved = [];
for (const [, rel, , body] of text.matchAll(re)) {
  const dest = path.resolve(root, rel);
  // Model output is untrusted: keep every write inside the staging folder.
  if (path.isAbsolute(rel) || !dest.startsWith(root + path.sep)) { console.error(`skipped unsafe path: ${rel}`); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body + '\n');
  saved.push(rel);
}
fs.writeFileSync(path.join(root, '_draft-response.md'), text);
console.log(saved.length ? `staged ${saved.length} file(s) in ${root}:\n  ${saved.join('\n  ')}` : `no files parsed; full reply in ${path.join(root, '_draft-response.md')}`);
const notes = text.split(/^#*\s*\**NOTES\**:?\s*$/im)[1];
if (notes) console.log(`\nNOTES:${notes.trim().slice(0, 1500) ? '\n' + notes.trim().slice(0, 1500) : ''}`);
console.error(`[model: ${j.model}]`);
