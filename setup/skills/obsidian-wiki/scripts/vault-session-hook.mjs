// Files every Claude Code session into the Obsidian vault and links it to its project, as you work.
// Stop hook: node vault-session-hook.mjs            (reads the hook JSON on stdin; never blocks)
// Backfill:  node vault-session-hook.mjs --backfill  (every past session under ~/.claude/projects)
// Self-test: node vault-session-hook.mjs --test
// Writes wiki/sessions/<date> <title>.md (one note per session, kept up to date) and one link line in the
// project page's "## Sessions" section. A session in a new project folder gets a draft project page.
// Only titles, dates and folders are written: never prompts or replies (they can hold customer data or keys).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.OBSIDIAN_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault');
const INDEX = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'agent-hub', 'vault-sessions.json');
const CONF = JSON.parse(fs.readFileSync(path.join(HERE, 'vault-projects.json'), 'utf8'));
const low = (p) => path.resolve(p).toLowerCase();
const under = (p, root) => { const r = path.relative(low(root), low(p)); return !r.startsWith('..') && !path.isAbsolute(r); };

// Emails, phone-like and long digit runs are cut from titles before they reach the shared vault.
const REDACT = Object.entries(CONF.redact || {}).map(([w, r]) => [new RegExp(`\\b${w}\\b`, 'gi'), r]);
export const scrub = (s) => REDACT.reduce((t, [re, r]) => t.replace(re, r), String(s || '')).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s-]{6,}\d/g, '[number]').replace(/\s+/g, ' ').trim();
const fileSafe = (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, '-').slice(0, 80).trim();

// Head and tail of the transcript are enough: first timestamp from the head, newest title from the tail.
export function readMeta(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b.toString('utf8'); };
  const head = read(0, Math.min(size, 256 * 1024)), tail = read(Math.max(0, size - 512 * 1024), Math.min(size, 512 * 1024));
  fs.closeSync(fd);
  const meta = { started: '', updated: '', title: '', cwd: '', prompts: 0 };
  for (const [chunk, first] of [[head, true], [tail, false]]) for (const l of chunk.split('\n')) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (!j || typeof j !== 'object') continue;
    if (j.timestamp) { if (first && !meta.started) meta.started = j.timestamp; if (!first || !meta.updated) meta.updated = j.timestamp; }
    if (j.cwd && !meta.cwd) meta.cwd = j.cwd;
    if (j.customTitle || j.aiTitle) meta.title = j.customTitle || j.aiTitle;
    if (first && j.type === 'user' && !j.isMeta && typeof j.message?.content === 'string') meta.prompts++;
  }
  return meta;
}

// Folder first (longest match), then title; an unknown folder below a container becomes a new project.
export function projectFor(cwd, title) {
  if (!cwd || CONF.ignoreFolders.some((f) => under(cwd, f))) return { skip: true };
  let best = null;
  for (const p of CONF.projects) for (const f of p.folders) if (under(cwd, f) && (!best || f.length > best.len)) best = { slug: p.slug, len: f.length };
  if (best) return { slug: best.slug };
  const t = String(title || '').toLowerCase();
  const byTitle = t && CONF.projects.find((p) => p.titles.some((re) => new RegExp(re, 'i').test(t)));
  if (byTitle) return { slug: byTitle.slug };
  if (under(cwd, CONF.scratch) || CONF.containers.some((c) => low(c) === low(cwd))) return { slug: null };
  const box = CONF.containers.filter((c) => under(cwd, c)).sort((a, b) => b.length - a.length)[0];
  if (!box) return { slug: null };
  const name = path.relative(path.resolve(box), path.resolve(cwd)).split(/[\\/]/)[0];
  return { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, folder: path.join(box, name), isNew: true };
}

const fm = (o) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : JSON.stringify(String(v))}`).join('\n') + '\n---\n';

function ensureProjectPage(proj, day) {
  const p = path.join(VAULT, 'wiki', 'entities', `${proj.slug}.md`);
  if (fs.existsSync(p) || !proj.isNew) return p;
  fs.writeFileSync(p, fm({ title: proj.name, type: 'entity', created: day, updated: day, status: 'draft', domain: '', next_step: 'Describe this project (made automatically from its first session).', tags: ['project'] })
    + `\n# ${proj.name}\n\n## Definition / identity\nProject folder: \`${proj.folder}\`. Page made automatically when its first Claude session ran; fill in what it is.\n\n## Current state\nunknown\n\n## Sessions\n\n## Related\n- [[index]]\n`, { flag: 'wx' });
  return p;
}

// Adds the session link once; keeps the page otherwise untouched.
export function addSessionLine(page, noteName, line) {
  let t = fs.readFileSync(page, 'utf8');
  if (t.includes(`[[${noteName}`)) return false;
  const m = t.match(/^## Sessions[ \t]*\r?\n/m);
  if (m) { const i = m.index + m[0].length; t = t.slice(0, i) + line + '\n' + t.slice(i); }
  else t = t.trimEnd() + `\n\n## Sessions\n${line}\n`;
  fs.writeFileSync(page, t);
  return true;
}

export function fileSession(transcript, sessionId) {
  const meta = readMeta(transcript);
  if (!meta.started || !meta.prompts && !meta.title) return null; // empty or a one-shot probe
  const proj = projectFor(meta.cwd, meta.title);
  if (proj.skip) return null;
  const day = meta.started.slice(0, 10), title = scrub(meta.title) || 'Untitled session';
  const dir = path.join(VAULT, 'wiki', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  // One note per session id; its file name is fixed at first write so links never break when the title changes.
  // A local id -> note index avoids opening every note each turn; a missing or stale entry falls back to a scan.
  let idx = {}; try { idx = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { /* first run */ }
  const known = idx[sessionId] && fs.existsSync(path.join(dir, `${idx[sessionId]}.md`)) ? `${idx[sessionId]}.md` : null;
  const existing = known || fs.readdirSync(dir).find((f) => f.endsWith('.md') && fs.readFileSync(path.join(dir, f), 'utf8').includes(`session: "${sessionId}"`));
  const noteName = existing ? existing.slice(0, -3) :fileSafe(`${day} ${title}`) + (fs.existsSync(path.join(dir, fileSafe(`${day} ${title}`) + '.md')) ? ` ${sessionId.slice(0, 6)}` : '');
  const folder = proj.slug && !under(meta.cwd, CONF.scratch) ? meta.cwd : '';
  const body = fm({ type: 'session', session: sessionId, title, project: proj.slug ? `[[${proj.slug}]]` : '', folder, started: meta.started.slice(0, 16).replace('T', ' '), updated: meta.updated.slice(0, 16).replace('T', ' '), status: 'draft', tags: ['session'] })
    + `\n# ${title}\n\nClaude Code session, ${day}${folder ? ` in \`${folder}\`` : ''}.\n\n`
    + (proj.slug ? `Project: [[${proj.slug}]]\n` : 'Project: not linked yet. Claude links it when it next works on it; add a title rule in `vault-projects.json` to link sessions like this automatically. See [[Sessions]].\n');
  fs.writeFileSync(path.join(dir, `${noteName}.md`), body);
  if (idx[sessionId] !== noteName) { idx[sessionId] = noteName; try { fs.mkdirSync(path.dirname(INDEX), { recursive: true }); fs.writeFileSync(INDEX, JSON.stringify(idx)); } catch { /* index is only a speed-up */ } }
  let linked = false;
  if (proj.slug) {
    const page = ensureProjectPage(proj, day);
    if (fs.existsSync(page)) linked = addSessionLine(page, noteName, `- [[${noteName}|${day} — ${title}]]`);
  }
  return { noteName, slug: proj.slug, linked };
}

const MAIN = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (MAIN && process.argv.includes('--test')) {
  const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } };
  ok(projectFor(path.join(os.homedir(), 'Downloads', 'Projects', 'My App', 'src'), '').slug === 'my-app', 'folder match');
  ok(projectFor(CONF.scratch + '\\x', 'Office printer IP address issue').slug === 'it-support', 'title match');
  ok(projectFor(CONF.scratch + '\\x', 'Something new').slug === null, 'scratch unmatched');
  const n = projectFor(path.join(os.homedir(), 'Downloads', 'Projects', 'Brand New', 'app'), '');
  ok(n.isNew && n.slug === 'brand-new' && n.name === 'Brand New', 'new project folder');
  ok(projectFor(path.join(os.tmpdir(), 'claude', 'x'), 'a').skip, 'temp ignored');
  ok(scrub('Mail to a@b.co.za +27 82 123 4567') === 'Mail to [email] [number]', 'scrub');
  ok(scrub('Email from Alex: CSV') === 'Email from a colleague: CSV', 'redact names');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vsh-')), pg = path.join(tmp, 'p.md');
  fs.writeFileSync(pg, '# P\n\n## Sessions\n- old\n\n## Related\n');
  ok(addSessionLine(pg, 'n1', '- [[n1|x]]') && !addSessionLine(pg, 'n1', '- [[n1|x]]'), 'link added once');
  ok(fs.readFileSync(pg, 'utf8').includes('## Sessions\n- [[n1|x]]\n- old'), 'link under Sessions');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(process.exitCode ? 'tests failed' : 'all tests passed');
} else if (MAIN && process.argv.includes('--backfill')) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  let n = 0;
  for (const d of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.jsonl'))) {
    try { const r = fileSession(path.join(root, d, f), f.slice(0, -6)); if (r) { n++; console.log(`${r.slug || '(unlinked)'}  ${r.noteName}`); } } catch (e) { console.error(f, e.message); }
  }
  console.log(`${n} sessions filed`);
} else if (MAIN) {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    if (input.transcript_path && input.session_id && !process.env.VAULT_HOOK_OFF) fileSession(input.transcript_path, input.session_id);
  } catch { /* never break a session over the vault */ }
  process.exit(0);
}
