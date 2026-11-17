---
name: team-setup
description: Install the full RENTAEL Claude Code team setup (skills, rules, hooks, plugins, free models through OmniRoute, the Ollama/OpenCode agent hub) on top of the user's own setup. Use when the user asks to set up, install or check the full Claude setup, the team setup, the free models, OmniRoute or the agent hub.
---

# Team setup

Goal: the whole team setup works on this PC, and nothing of the user's own is replaced. It must also be easy on the PC: no terminal windows popping up, and no heavy downloads the machine can't carry. Done means every part below is installed and checked, or the user knows exactly which step is theirs and how to do it.

The setup lives in `<root>/setup`, where `<root>` is two folders above this skill's base directory. `setup/README.md` explains every part: read it first. Most users are on Windows; commands below are for Windows first, with macOS/Linux where they differ.

## No windows popping up

Run every command yourself in your own shell; that never opens a window. For anything that keeps running in the background (OmniRoute, the hub), use the `.vbs` launchers listed below. They start the program in a hidden console that its child programs share.

Don't use `start`, `cmd /k`, `Start-Process` without `-WindowStyle Hidden`, or `omniroute serve --daemon` on Windows. Tested on Windows 11: a detached background program opens a visible console window for each program it starts, and `--daemon` makes OmniRoute detach itself.

## 1. Check the PC first

```bash
powershell -NoProfile -Command "'RAM GB: ' + [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB); 'Free GB on C: ' + [math]::Round((Get-PSDrive C).Free/1GB)"
```

Use the result to suggest what fits, and tell the user why:
- **Under 8 GB RAM, or under 10 GB free disk:** skip Ollama (a 5 GB model that needs about 8 GB RAM to answer). The hub still works with the cloud free models. But jobs from folders marked local-only (private or customer data) then have no agent, and Claude does them itself.
- **The third-party skill packs (about 210 skills):** each skill's description costs context on every message. Suggest skipping them (`--no-packs`) unless the user wants them.
- **Whisper for voice notes** needs about 4 GB more disk. It is set up separately, the first time they use a voice note.

## 2. Preview, then install

Run the installer as a dry run, show the user the summary, and ask before the real run:

```bash
node "<root>/setup/install.mjs" --dry-run
node "<root>/setup/install.mjs"
```

- It is additive. It skips skills the user already has, writes only inside its own markers in CLAUDE.md, never changes an existing settings value, and backs up each file it changes. Don't hand-edit the user's CLAUDE.md or settings.json to "help": the installer's rules are what keep their own setup safe.
- It needs Node.js 20+. If `node` is missing, offer to install it (see the table below).
- A failed plugin or pack command prints and the run carries on. Retry those once at the end.

## 3. Install the tools behind it

Check each one first (`node --version`, `omniroute --version`, `ollama --version`, `opencode --version`) and skip what is there. Ask once for the user's OK. Say that installing with winget accepts each package's licence on their behalf. On Windows, add these flags to every winget command so nothing interactive appears: `--silent --disable-interactivity --accept-package-agreements --accept-source-agreements`.

| Tool | What it's for | Windows | macOS / Linux |
|---|---|---|---|
| Node.js 20+ | runs the installer and the hub | `winget install -e --id OpenJS.NodeJS.LTS` | `brew install node` |
| OmniRoute | gateway to the free models, port 20128 | `npm i -g omniroute` | same |
| Ollama | local model for private work in the hub, port 11434 (skip on small PCs, see step 1) | `winget install -e --id Ollama.Ollama`, then `ollama pull qwen2.5-coder:7b` | `brew install ollama` / the script on ollama.com |
| OpenCode | free cloud agent in the hub | `npm i -g @opencode/cli` | same |

After installing Node.js, a new shell may be needed before `node` and `npm` are found.

**Start OmniRoute without a window:**
- Windows: `wscript "<root>/setup/omniroute/omniroute.vbs"`. It logs to `%LOCALAPPDATA%\agent-hub\omniroute.log`. Give it about 20 seconds, then check `curl -s -o /dev/null -w "%{http_code}" http://localhost:20128/` answers.
- macOS/Linux: `omniroute serve --daemon --no-open`.

**Keep it running (ask first, since these start at every sign-in):**
- Windows, OmniRoute only: copy `<root>/setup/omniroute/omniroute.vbs` into the Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`).
- Windows, the whole hub (OmniRoute, Ollama, hub bridge, live view): run `powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/skills/obsidian-wiki/scripts/register-keepalive.ps1`. It adds a hidden Task Scheduler task that checks every 5 minutes and starts only what is down. It is tiny and opens no window. To remove it: `schtasks /delete /tn "Agent Hub keep-alive" /f`.

Ollama's installer adds its own tray app at sign-in, which has no console window. Ollama frees the model's memory a few minutes after its last answer.

## 4. Steps only the user can do

Walk them through these one at a time. Wait while they do each one. Never ask them to paste a key or password into the chat: it would sit in the transcript.

1. **Free-model providers:** open the OmniRoute dashboard (`http://localhost:20128`) and connect the free providers they want, such as Gemini, Groq and Cloudflare. Each needs their own sign-in.
2. **Gateway key:** they copy the OmniRoute gateway key and set it themselves as a user environment variable `LMSTUDIO_API_KEY`. On Windows: Start → "Edit environment variables for your account" → New. Or they type `setx LMSTUDIO_API_KEY "<your key>"` in their own terminal. Claude Code must be restarted to see it.
3. **MCP servers:** the installer printed `claude mcp add` commands. The Obsidian one needs the key from Obsidian's Local REST API plugin. They fill in their own values and run them; the rest have no secrets and you can run them with their OK.
4. **Obsidian vault (optional):** if they use the wiki, the vault defaults to `~/Documents/Obsidian Vault` (or `OBSIDIAN_VAULT`). They list their projects in `~/.claude/skills/obsidian-wiki/scripts/vault-projects.json`, and any folders with private or customer data in `local-only.json`. Work from those folders goes to the local Ollama model only.

## 5. Check it works

- Free models: `node ~/.claude/skills/free-models/ask.mjs --model free "Say ok"` answers.
- Ollama (if installed): `ollama list` shows the model.
- Agent hub: `node ~/.claude/skills/obsidian-wiki/scripts/agent-bridge.mjs --selftest` passes.
- Background parts: `node ~/.claude/skills/obsidian-wiki/scripts/keepalive.mjs --dry` lists each part as up or down.

Then tell the user what works, what is still theirs to do, and that Claude Code must be restarted to load the new skills, rules and hooks.

## Safety

- Keys and secrets never go into the repo, the chat, or a free model. They live only in the user's environment variables.
- Installing software, adding anything that starts at sign-in, and running the real install each need the user's OK first.
