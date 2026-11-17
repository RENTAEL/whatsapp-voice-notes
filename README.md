# WhatsApp Voice Notes for Claude

A Claude Code plugin that listens to WhatsApp voice notes for you.

1. **Whisper `large-v3` transcribes the audio on your own machine.** The audio is never uploaded.
2. **Claude revises the raw transcript.** It fixes misheard words and the Dutch spellings that creep into Afrikaans, and keeps the English words people mix in.
3. **You get back:**
   - a clean transcript
   - an English translation
   - action items and dates
   - a list of anything that was unclear

It is tuned for **Afrikaans and South African English** and works for any language Whisper knows: Zulu, Xhosa, Portuguese and many more.

## Install

In Claude Code:

```
/plugin marketplace add RENTAEL/whatsapp-voice-notes
/plugin install whatsapp-voice-notes@whatsapp-voice-notes
```

Then share a voice note with Claude:

> What does this voice note say? ~/Downloads/WhatsApp Ptt 2026-01-05 at 09.12.44.ogg

The first time, Claude sets everything up automatically, which takes 5 to 15 minutes:
- It creates a private Python environment in `~/.whatsapp-voice-notes`.
- It installs faster-whisper, plus the CUDA libraries if you have an NVIDIA GPU.
- It downloads the model, about 3 GB.

After that, a typical voice note takes a few seconds on a GPU and under a minute on a CPU.

## Requirements

| Need | How |
|---|---|
| **ffmpeg** | Windows: `winget install Gyan.FFmpeg` · macOS: `brew install ffmpeg` · Linux: `sudo apt install ffmpeg` |
| **Python 3.9–3.13**, or [uv](https://docs.astral.sh/uv/) (recommended: it fetches the right Python itself) | Windows: `winget install astral-sh.uv` · macOS: `brew install uv` |
| ~4 GB disk | for the model and environment |
| NVIDIA GPU *(optional)* | much faster; it falls back to the CPU automatically |

## Getting voice notes onto your computer

- **Phone:** long-press the voice note, tap **Share**, and send it to yourself by email, OneDrive or Google Drive. Or save it and copy it over.
- **WhatsApp Web or Desktop:** hover over the voice note, open the menu (⌄) and choose **Download**. It saves as `WhatsApp Ptt ….ogg` in your Downloads folder.

If you just say "transcribe my latest voice note", Claude looks in `~/Downloads`.

## Fetch voice notes straight from WhatsApp (optional)

Link the tool to your WhatsApp once, like WhatsApp Web. After that, just ask Claude:

> Listen to my latest voice note · What did Jabu say in his voice note? · Transcribe the last 3 voice notes

Claude connects to WhatsApp, downloads the note, transcribes and revises it, shows you the result and disconnects. **Nothing runs in the background**, and nothing is ever sent unless you ask Claude to reply and confirm the exact text.

**Before you link**
- **Ban risk:** this uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web library, which is against WhatsApp's terms. There is a small risk the number gets restricted.
- **Which notes it can see:** only voice notes received after linking. While it's disconnected, WhatsApp holds new messages for the linked device and delivers them the next time Claude connects.

**Needs:** Node.js 20+.

**Link (once):**
- Windows: double-click `start-whatsapp.bat`.
- Any system: `cd whatsapp && npm install && node bridge.mjs link`.
- Then on your phone open WhatsApp and go to **Settings → Linked devices → Link a device**, and scan the QR code. The device shows up as "Voice Notes".

**Commands (Claude runs these for you):**

```bash
node whatsapp/bridge.mjs fetch [--from "Jabu"] [--count 3]   # download newest received voice notes, prints JSON
node whatsapp/bridge.mjs reply <id> reply.txt                # reply in that chat, quoting the voice note
```

**What it skips:** your own voice notes, view-once notes, status updates and channels.

**Where things are stored:**
- The login is in `~/.whatsapp-voice-notes/whatsapp-auth`. Treat it like a password.
- The list of received notes is in `whatsapp-index.json`, in the same folder.

**To unlink:** remove the "Voice Notes" device on your phone.

Filter tests: `cd whatsapp && npm test`.

## Web app (optional)

Run `python scripts/run.py`, or on Windows double-click `start.bat`, then open http://localhost:8765. On that page you can:
- drag in voice notes
- play them and seek through long ones
- read the raw transcript and Whisper's English translation

The polished revision comes from asking Claude.

## Command line

```bash
python scripts/run.py note1.ogg note2.opus   # JSON transcript per file
python scripts/run.py --setup                # set up only
```

Settings (environment variables):

| Variable | Does | Default |
|---|---|---|
| `WHISPER_MODEL` | Model to use. Avoid `*-turbo` models, because they can't translate. | `large-v3` |
| `VOICE_NOTES_HOME` | Where the environment and notes live | `~/.whatsapp-voice-notes` |
| `PORT` | Web app port | `8765` |

## Privacy

- **Audio:** transcribed locally and stored only in `~/.whatsapp-voice-notes/notes` when you use the web app.
- **Transcript text:** Claude sees it so it can revise and translate it.
- **Nothing else:** nothing is sent to any other service. The web app accepts requests only from `localhost`.

## How it works

- `scripts/run.py`: a standard-library-only bootstrapper. It sets up the environment and model once, then runs the app.
- `scripts/voice_notes.py`:
  - decodes any audio format with ffmpeg
  - detects the language
  - for Afrikaans, forces `af` with a local vocabulary hint, since Whisper often mistakes Afrikaans for Dutch
  - transcribes, translates and serves the web app
- `whatsapp/bridge.mjs`: on-demand WhatsApp link (`link` / `fetch` / `reply`), using Baileys.
- `skills/whatsapp-voice-notes/SKILL.md`: the exact steps Claude follows, including the revision rules for Afrikaans.

## The whole Claude setup (optional)

The [`setup/`](setup/) folder holds the full Claude Code setup this was built with: skills, plugins, rules, hooks, free models through OmniRoute, and the agent hub. Its installer only adds what you don't have. It never replaces your own CLAUDE.md rules, settings or skills, and it holds no keys.

```bash
node setup/install.mjs --dry-run
```

See [setup/README.md](setup/README.md) for details.

## License

MIT
