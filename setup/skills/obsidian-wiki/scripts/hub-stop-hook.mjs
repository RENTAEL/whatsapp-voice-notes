// Claude Code Stop hook: if this turn created a new code file but never ran hub-ask,
// block the stop once and ask Claude to run the agent hub loop (or say why it is skipped).
// Usage in settings.json: node "<this file>"   Self-test: node hub-stop-hook.mjs --test
import fs from 'node:fs';

const CODE = /\.(m?js|cjs|jsx|tsx?|py|ps1|psm1|sh|bash|go|rs|cs|java|kt|php|rb|swift|c|cc|cpp|h|hpp|sql|lua|dart)$/i;
const REASON = 'You created new code this turn (FILES) but did not run the agent hub. Per CLAUDE.md, run the team loop now: '
  + 'node "%USERPROFILE%/.claude/skills/obsidian-wiki/scripts/hub-ask.mjs" --name "<job>" --kind code --file <brief.md>, '
  + 'test every reply in a staging folder, send fix rounds if close, then write "## Claude verdict" and status: done on every note. '
  + 'If this file is only a throwaway helper, a test of your own, config, or private work Ollama cannot help with, say so in one line and finish.';

const isPrompt = (e) => e.type === 'user' && !e.isMeta && !e.toolUseResult && (typeof e.message?.content === 'string'
  || (Array.isArray(e.message?.content) && !e.message.content.some((c) => c.type === 'tool_result')));

export function check(lines) {
  const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  let start = 0;
  entries.forEach((e, i) => { if (isPrompt(e)) start = i; });
  const turn = entries.slice(start);
  const created = turn.filter((e) => e.toolUseResult?.type === 'create' && CODE.test(e.toolUseResult.filePath || ''))
    .map((e) => e.toolUseResult.filePath);
  const ranHub = turn.some((e) => e.type === 'assistant' && (e.message?.content || [])
    .some((c) => c.type === 'tool_use' && /hub-ask/.test(String(c.input?.command || ''))));
  return created.length && !ranHub ? created : null;
}

if (process.argv.includes('--test')) {
  const a = (cmd) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }] } });
  const mk = (f, type = 'create') => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] }, toolUseResult: { type, filePath: f } });
  const p = (t) => JSON.stringify({ type: 'user', message: { content: t } });
  const cases = [
    [[p('write it'), mk('a/x.mjs')], true, 'new code, no hub'],
    [[p('write it'), mk('a/x.mjs'), a('node hub-ask.mjs --name x')], false, 'hub ran'],
    [[p('write it'), mk('a/x.mjs', 'update')], false, 'edit of existing file'],
    [[p('write it'), mk('a/notes.md')], false, 'not code'],
    [[p('one'), mk('a/x.py'), p('two'), a('ls')], false, 'code was in an earlier turn'],
    [['not json', p('go'), mk('C:\\p\\y.ps1')], true, 'bad line, windows path'],
  ];
  let bad = 0;
  for (const [lines, want, name] of cases) if (!!check(lines) !== want) { bad++; console.log('FAIL', name); }
  console.log(`${cases.length - bad}/${cases.length} passed`);
  process.exit(bad ? 1 : 0);
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  if (input.stop_hook_active || process.env.HUB_HOOK_OFF || !input.transcript_path) process.exit(0);
  const files = check(fs.readFileSync(input.transcript_path, 'utf8').split('\n'));
  if (files) console.log(JSON.stringify({ decision: 'block', reason: REASON.replace('FILES', files.map((f) => f.split(/[\\/]/).pop()).join(', ')) }));
} catch { /* never break a session over this check */ }
process.exit(0);
