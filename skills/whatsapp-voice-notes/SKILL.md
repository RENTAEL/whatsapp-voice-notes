---
name: whatsapp-voice-notes
description: Listen to WhatsApp voice notes and other audio files, transcribe them on this machine, then return a cleaned-up transcript and an English translation. Built for Afrikaans and South African English, and works for any language. Use when the user shares, attaches or mentions a voice note, a "WhatsApp Ptt" or "WhatsApp Audio" file, or an .opus, .ogg, .m4a, .mp3, .wav or .aac recording; when they ask what a voice note says; or when they ask to transcribe or translate audio or to open the voice-notes app.
---

# WhatsApp voice notes

The audio is transcribed on this machine by Whisper (`large-v3`). You, Claude, then revise the raw machine transcript into clean text and translate it. Follow these steps in order.

## Step 1: find the plugin root and the file

- The plugin root is two folders above this skill's base directory: `<base>/../..`. It contains `scripts/run.py`.
- The audio file is the path the user gave or attached.
- If the user gave no file, list the newest audio files in `~/Downloads`: `WhatsApp Ptt*`, `WhatsApp Audio*`, `PTT-*`, `AUD-*`, `*.opus`. Ask which one(s) they mean.

## Step 2: transcribe

Run this, quoting every path:

```bash
python "<root>/scripts/run.py" "<audio file>" ["<audio file 2>" ...]
```

- Use `python3` if `python` is not found, or `py` on Windows.
- Set the Bash timeout to 600000 ms.

**First run only.** `run.py` sets itself up:
- It creates `~/.whatsapp-voice-notes/venv` and installs faster-whisper (plus the CUDA libraries if there is an NVIDIA GPU).
- It downloads the 3 GB model.
- This takes 5 to 15 minutes. Tell the user that, and run it in the background if your harness allows.
- Progress lines start with `[voice-notes]` on stderr.

**If setup stops:**
- `MISSING ffmpeg`: show the user the install command it printed, and run it only with their OK. Then retry in a new shell.
- `Need Python 3.9-3.13`: suggest installing uv (`winget install astral-sh.uv`, `brew install uv`, or `pip install uv`), then retry.
- Any other error: show the last lines of the output, and do not guess a fix.

**Output.** stdout has one JSON object per file:
- `text`: the raw transcript in the spoken language. Notes over 90 seconds include `[mm:ss]` timestamps.
- `english`: Whisper's own rough English translation, or `null` if the note is in English.
- `language`: the detected language code (`af`, `en`, `zu`, ...).
- `seconds`: the length of the note.
- `error`: present only if that file failed.

## Step 3: revise (the important part)

The raw transcript is a draft. Whisper mishears words and mixes Afrikaans with Dutch. Revise it as follows.

**Language**
- Fix Dutch spellings to Afrikaans: zij→sy, ik→ek, kijk→kyk, morgen→môre, ochtend→oggend, ochtendacht→oggend agt, niet→nie, een→'n, wij→ons, jij→jy, heel→baie (where meant), dacht→dag/dalk (from context).
- Keep the English words the speaker used, as South Africans mix languages (data, hotspot, dongle, printer, laptop, connect, thanks, bye). Do not "translate" them into Afrikaans.
- Fix words that sound alike from context. Typical cases: "hardspat"/"hartspat" = hotspot; "datel" = data; "dankel"/"dongel" = dongle; "sikkel"/"sik al" = "sit" or "klaar"; "salf"/"self" = "selfoon" (cellphone).

**Facts**
- Use the `english` field as a second witness. When the two disagree, the version that makes sense in context usually wins.
- Keep names, numbers, times and dates exactly as spoken. For example, "8 uur" is 8 o'clock, so keep it as 8 o'clock.
- Never invent content.
- If a part is still unclear after revising, write `[onduidelik]` or `[unclear]` in place of it. List your guess in the "Unclear" section rather than presenting it as fact.

**Other languages**: do the same. Fix obvious recognition errors, and keep the speaker's own words.

## Step 4: send it back to the user

Reply in chat in this format, with one block per voice note:

```
🎙️ <file name> · <seconds>s · <language name>

**English**
<clean, natural English translation of your revised text>

**Afrikaans (revised)**   ← use the spoken language's name; leave this block out when the note was in English
<your corrected transcript>

**Action items / dates**
- <who does what, when>  (or "None")

**Unclear**
- <word or phrase heard> → <your best guess>  (or "Nothing unclear")
```

- For notes over 5 minutes, put a 3 to 5 bullet summary with `[mm:ss]` timestamps first. Then give the full revised transcript.
- If the user asks you to send the result somewhere (email, Teams, WhatsApp, a file), draft it and show them. Send only after they confirm.

## Privacy

- Voice notes are private. The audio stays on this machine; only the text transcript is seen by you, Claude.
- Do not send audio or transcripts to any other AI service, website or third-party tool unless the user explicitly asks.
- Do not save transcripts into notes, wikis or memory unless asked.
- Audio uploaded through the web app is stored in `~/.whatsapp-voice-notes/notes`.

## Web app (optional, for the user)

- `python "<root>/scripts/run.py"` with no file starts a local page at http://localhost:8765.
- On that page the user can drag in voice notes, play them (and seek through long ones) and read the raw transcript and Whisper's English.
- On Windows the user can double-click `start.bat` in the plugin root instead.

## Settings (environment variables)

- `WHISPER_MODEL`: the model to use; default `large-v3`. Do not use `*-turbo` models, because they cannot translate.
- `VOICE_NOTES_HOME`: the data folder; default `~/.whatsapp-voice-notes`.
- `PORT`: the web app port; default 8765.
