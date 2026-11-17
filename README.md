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
- `skills/whatsapp-voice-notes/SKILL.md`: the exact steps Claude follows, including the revision rules for Afrikaans.

## License

MIT
