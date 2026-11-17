---
name: team-setup
description: Install the full RENTAEL Claude Code team setup (skills, rules, hooks, plugins, free models through OmniRoute, the Ollama/OpenCode agent hub) on top of the user's own setup. Use when the user asks to set up, install or check the full Claude setup, the team setup, the free models, OmniRoute or the agent hub.
---

# Team setup

Goal: the user ends up with the whole team setup working on this machine, and nothing of their own replaced. Done means every part below is installed and checked, or the user knows exactly which step is theirs and how to do it.

The setup lives in `<root>/setup`, where `<root>` is two folders above this skill's base directory. `setup/README.md` explains every part: read it first.

## 1. Preview, then install

Run the installer as a dry run, show the user the summary, and ask before the real run:

```bash
node "<root>/setup/install.mjs" --dry-run
node "<root>/setup/install.mjs"
```

- It is additive. It skips skills the user already has, writes only inside its own markers in CLAUDE.md, never changes an existing settings value, and backs up each file it changes. Don't hand-edit the user's CLAUDE.md or settings.json to "help": the installer's rules are what keep their own setup safe.
- It needs Node.js 20+. If `node` is missing, offer `winget install OpenJS.NodeJS.LTS` (Windows) or `brew install node` (macOS).
- The skill packs add about 210 skills, which cost context on every message. Ask whether they want them; if not, add `--no-packs`.
- A failed plugin or pack command prints and the run carries on. Retry those once at the end.

## 2. Install the tools behind it

Ask once for the user's OK, then install the missing ones. Check each first (`ollama --version`, `omniroute --version`, `opencode --version`) and skip what is there.

| Tool | What it's for | Install |
|---|---|---|
| OmniRoute | gateway to the free models, port 20128 | `npm i -g omniroute`, then `omniroute serve --daemon --no-open` |
| Ollama | local model for private work in the agent hub, port 11434 | Windows `winget install Ollama.Ollama` · macOS `brew install ollama` · Linux: the script on ollama.com. Then `ollama pull qwen2.5-coder:7b` |
| OpenCode | free cloud agent in the hub | `npm i -g @opencode/cli` |

On Windows, offer to start OmniRoute at sign-in by copying `<root>/setup/omniroute/omniroute.vbs` into the Startup folder (`shell:startup`). That runs at every sign-in, so ask first.

## 3. Steps only the user can do

Walk them through these one at a time. Wait while they do each one. Never ask them to paste a key or password into the chat: it would sit in the transcript.

1. **Free-model providers:** open the OmniRoute dashboard (`http://localhost:20128`) and connect the free providers they want, such as Gemini, Groq and Cloudflare. Each needs their own sign-in.
2. **Gateway key:** they copy the OmniRoute gateway key and set it themselves as a user environment variable `LMSTUDIO_API_KEY`. Give them the command with a placeholder, e.g. Windows `setx LMSTUDIO_API_KEY "<your key>"`. A new terminal and a Claude Code restart are needed to see it.
3. **MCP servers:** the installer printed `claude mcp add` commands. The Obsidian one needs the key from Obsidian's Local REST API plugin. They fill in their own values and run them; the rest have no secrets and you can run them with their OK.
4. **Obsidian vault (optional):** if they use the wiki, the vault defaults to `~/Documents/Obsidian Vault` (or `OBSIDIAN_VAULT`). They list their projects in `~/.claude/skills/obsidian-wiki/scripts/vault-projects.json`, and any folders with private or customer data in `local-only.json`. Work from those folders goes to the local Ollama model only.

## 4. Check it works

- Free models: `node ~/.claude/skills/free-models/ask.mjs --model free "Say ok"` answers.
- Ollama: `ollama list` shows the model.
- Agent hub: `node ~/.claude/skills/obsidian-wiki/scripts/agent-bridge.mjs --selftest` passes.

Then tell the user what works, what is still theirs to do, and that Claude Code must be restarted to load the new skills, rules and hooks.

## Safety

- Keys and secrets never go into the repo, the chat, or a free model. They live only in the user's environment variables.
- Installing software, adding a startup entry and running the real install each need the user's OK first.
