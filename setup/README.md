# Team setup for Claude Code

This folder holds a full Claude Code setup: the skills, plugins, rules, hooks, free-model routing and agent hub that this project was built with. It installs **on top of** your own setup and never replaces it.

**No keys or secrets are in this folder.** You add your own (see `.env.example`).

## Install

You need Node.js 20+, plus Claude Code itself.

```bash
git clone https://github.com/RENTAEL/whatsapp-voice-notes
node whatsapp-voice-notes/setup/install.mjs --dry-run   # see what it would do
node whatsapp-voice-notes/setup/install.mjs             # do it
```

Then restart Claude Code.

Options:
- `--dry-run`: shows every change and command, and changes nothing.
- `--no-plugins`: skip the plugin marketplaces and plugins.
- `--no-packs`: skip the third-party skill packs (about 210 skills).

## What it does, and what it never does

| Part | What it adds | What it leaves alone |
|---|---|---|
| Skills | Copies the skills in `skills/` into `~/.claude/skills`. | A skill you already have with the same name: yours is kept. |
| Rules | Adds one block to `~/.claude/CLAUDE.md`, between `team-setup:begin` and `team-setup:end` markers. On a later run it refreshes only that block. The block tells Claude to always use these skills, and says your own rules win on any conflict. | Everything outside the markers. |
| Settings | Adds missing keys to `~/.claude/settings.json`: hooks, env, plugin marketplaces, enabled plugins. | Any key you already set, including a plugin you turned off. |
| Plugins | Adds the marketplaces and installs the plugins you don't have. | Plugins you already have. |
| Skill packs | Installs the third-party skills listed in `skill-packs.json` that you don't have. | Skills you already have. |
| MCP servers | Prints the `claude mcp add` commands. | Your MCP config: it never adds servers itself, because some need your own keys. |

Every file it changes is backed up first as `<file>.bak-<date-time>`. Running it twice changes nothing the second time.

## What's in here

- **`skills/`**: skills written for this setup.
  - `free-models`: sends side jobs (second opinions, summaries, drafts) to free models through the local OmniRoute gateway.
  - `agent-hub` and `obsidian-wiki`: the agent hub. OpenCode, Ollama and OmniRoute answer the same brief in an Obsidian vault; Claude tests every answer and writes the verdict. It also covers the Obsidian wiki itself, with session and subagent hooks and a live view on port 4317.
  - `pool-consult`: second opinions from Poolside's `pool` CLI.
  - `writing-skills`: house rules for writing skills.
- **`CLAUDE.md`**: the rules block: always use these skills, work as a team of subagents, the agent-hub loop, the wiki, and the safety rules.
- **`settings.additions.json`**: the hooks, env and plugins that get merged in.
- **`skill-packs.json`**: third-party skill packs, by source repo. They are installed from their own repos, not copied here.
- **`mcp-servers.json`**: the MCP servers used (memory vault, OmniRoute, Obsidian, REA, agent-desktop), with placeholders for keys.
- **`omniroute/omniroute.vbs`**: starts the OmniRoute gateway hidden at Windows sign-in. To use it, copy it into `shell:startup`.
- **`.env.example`**: the environment variables to set yourself.

## After installing

1. **Free models.** Install and start OmniRoute: `npm i -g omniroute && omniroute serve --daemon --no-open`. Connect your free providers in its dashboard, then set `LMSTUDIO_API_KEY` to its gateway key as a user environment variable.
2. **Agent hub (optional).** Install [Ollama](https://ollama.com) with a small coder model (`ollama pull qwen2.5-coder:7b`) and the OpenCode CLI (`npm i -g @opencode/cli`).
3. **Obsidian wiki (optional).** The default vault is `~/Documents/Obsidian Vault`; set `OBSIDIAN_VAULT` to use another one. Edit `~/.claude/skills/obsidian-wiki/scripts/vault-projects.json` (your projects) and `local-only.json` (folders whose work must never go to cloud models).
4. **MCP servers.** Run the commands the installer printed, filling in your own keys.

The hooks do nothing harmful when the vault, Ollama or OmniRoute are missing: they exit quietly.

## Privacy

- The agent hub sends briefs to cloud free models (OmniRoute, OpenCode). Jobs from folders listed in `local-only.json`, and anything that looks like a credential, go to the local Ollama only.
- The session hook writes only titles, dates and folders into the vault, never prompts or replies. Emails and phone numbers are cut from titles.

Tests: `node --test setup/install.test.mjs`
