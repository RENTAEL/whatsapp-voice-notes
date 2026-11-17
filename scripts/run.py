"""One entry point: sets everything up on first use, then runs voice_notes.py.

  python scripts/run.py note.ogg [more files]   transcribe (JSON per file on stdout)
  python scripts/run.py                          web app on http://localhost:8765
  python scripts/run.py --setup                  only set up (env + model download), then exit

Uses only the standard library, so any Python 3.9+ can start it. Everything it installs
goes into ~/.whatsapp-voice-notes (override with VOICE_NOTES_HOME).
"""
import os, shutil, subprocess, sys, venv
from pathlib import Path

HOME = Path(os.environ.get("VOICE_NOTES_HOME", Path.home() / ".whatsapp-voice-notes"))
VENV = HOME / "venv"
PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
READY = HOME / ".ready-v1"
MODEL = os.environ.get("WHISPER_MODEL", "large-v3")
APP = Path(__file__).with_name("voice_notes.py")
FFMPEG_HELP = {"nt": "winget install Gyan.FFmpeg", "darwin": "brew install ffmpeg"}


def say(msg):
    print(f"[voice-notes] {msg}", file=sys.stderr, flush=True)


def setup():
    if not shutil.which("ffmpeg"):
        hint = FFMPEG_HELP.get("darwin" if sys.platform == "darwin" else os.name, "sudo apt install ffmpeg")
        say(f"MISSING ffmpeg. Install it with:  {hint}   then open a new terminal and run again.")
        sys.exit(2)
    if READY.exists() and PY.exists():
        return
    HOME.mkdir(parents=True, exist_ok=True)
    if not PY.exists():
        uv = shutil.which("uv")
        if uv:  # uv fetches a Python that faster-whisper has wheels for
            subprocess.run([uv, "venv", "--python", "3.12", str(VENV)], check=True)
        elif sys.version_info < (3, 9) or sys.version_info >= (3, 14):
            say("Need Python 3.9-3.13 (or install uv: https://docs.astral.sh/uv/). Then run again.")
            sys.exit(2)
        else:
            venv.create(VENV, with_pip=True)
    pkgs = ["faster-whisper>=1.1", "numpy"]
    if shutil.which("nvidia-smi") and sys.platform != "darwin":  # NVIDIA GPU: CUDA libraries as pip wheels
        pkgs += ["nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*"]
    say("Installing Whisper (one time, a few minutes)...")
    uv = shutil.which("uv")
    cmd = [uv, "pip", "install", "--python", str(PY)] if uv else [str(PY), "-m", "pip", "install", "-q"]
    subprocess.run(cmd + pkgs, check=True)
    say(f"Downloading the Whisper '{MODEL}' model (one time, about 3 GB)...")
    subprocess.run([str(PY), "-c", f"from faster_whisper.utils import download_model; download_model({MODEL!r})"],
                   check=True)
    READY.write_text("ok")
    say("Setup done.")


if __name__ == "__main__":
    setup()
    if sys.argv[1:] == ["--setup"]:
        sys.exit(0)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    sys.exit(subprocess.run([str(PY), str(APP), *sys.argv[1:]], env=env).returncode)
