"""Local WhatsApp voice-note transcriber. The audio never leaves this machine.

Start it through run.py (it sets up the environment first):
  python scripts/run.py note.ogg [more files]   -> JSON transcript per file (used by the Claude skill)
  python scripts/run.py                          -> web app on http://localhost:8765
"""
import glob, json, os, re, subprocess, sys, threading, urllib.request
import numpy as np
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(os.environ.get("VOICE_NOTES_HOME", Path.home() / ".whatsapp-voice-notes"))
NOTES = DATA / "notes"  # outside the repo, so private audio can never be committed
NOTES.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("PORT", 8765))
AUDIO_EXT = {".opus", ".ogg", ".m4a", ".mp3", ".wav", ".aac"}
OLLAMA = "http://localhost:11434"

# CUDA DLLs come from the nvidia-* pip wheels; Windows needs them on the search path.
for d in glob.glob(str(Path(sys.prefix) / "Lib/site-packages/nvidia/*/bin")):
    if hasattr(os, "add_dll_directory"):  # Windows only
        os.add_dll_directory(d)
    os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")

AF_HINT = ("Hallo, ek praat Afrikaans, met 'n paar Engelse woorde soos data, hotspot, dongle, printer, "
           "laptop, router, WiFi, Teams, e-pos. Môreoggend, rekenaar, kantoor, opstel, laat weet.")
_model, _lock = None, threading.RLock()  # re-entrant: transcribe() holds it while calling model()


def model():
    global _model
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel
            name = os.environ.get("WHISPER_MODEL", "large-v3")  # best for Afrikaans; turbo models can't translate
            try:  # cached copy first: the online check can hang for minutes
                from faster_whisper.utils import download_model
                download_model(name, local_files_only=True)
                local = True
            except Exception:
                local = False
            try:
                _model = WhisperModel(name, device="cuda", compute_type="float16", local_files_only=local)
                print(f"Whisper {name} on GPU", file=sys.stderr)
            except Exception as e:  # no usable GPU -> same model on CPU: slower, same accuracy
                print(f"GPU unavailable ({e}); using CPU", file=sys.stderr)
                _model = WhisperModel(name, device="cpu", compute_type="int8", local_files_only=local)
        return _model


def load_audio(path: Path) -> np.ndarray:
    """Any audio format -> 16 kHz mono float32, via the system ffmpeg (PyAV in the wheel is incompatible)."""
    p = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                       capture_output=True, timeout=600)
    if p.returncode or not p.stdout:
        raise RuntimeError("ffmpeg could not read the audio: " + p.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(p.stdout, np.int16).astype(np.float32) / 32768


def transcribe(path: Path) -> dict:
    audio = load_audio(path)
    with _lock:  # one job at a time on the GPU
        segs, info = model().transcribe(audio, vad_filter=True)  # segments are lazy: only language detection has run
        if info.language in ("af", "nl"):  # Whisper often mistakes Afrikaans for Dutch; force af + local vocabulary
            segs, info = model().transcribe(audio, vad_filter=True, language="af", initial_prompt=AF_HINT)
        segs = list(segs)
        # long notes get [mm:ss] markers so you can find the spot in the audio
        stamp = (lambda s: f"[{int(s.start)//60:02d}:{int(s.start)%60:02d}] ") if info.duration > 90 else (lambda s: "")
        text = ("\n" if info.duration > 90 else " ").join(stamp(s) + s.text.strip() for s in segs).strip()
        english = None
        if info.language != "en" and text:  # Whisper's built-in speech -> English translation
            segs, _ = model().transcribe(audio, vad_filter=True, task="translate", language=info.language,
                                         condition_on_previous_text=False)  # stops repeat-loops on long notes
            english = " ".join(s.text.strip() for s in segs).strip()
    return {"text": text, "english": english, "language": info.language, "seconds": round(info.duration)}


def summarize(text: str) -> str | None:
    """Short summary from a local Ollama model, or None if Ollama isn't running."""
    if len(text) < 200:
        return None
    try:
        tags = json.load(urllib.request.urlopen(f"{OLLAMA}/api/tags", timeout=2))
        name = next(m["name"] for m in tags["models"] if "embed" not in m["name"])
        body = json.dumps({"model": name, "stream": False, "options": {"num_ctx": 16384}, "prompt":
            "Summarise this WhatsApp voice note in 1-3 short bullet points, "
            "then list any action items or dates. Voice note:\n\n" + text}).encode()
        r = urllib.request.urlopen(urllib.request.Request(f"{OLLAMA}/api/generate", body), timeout=120)
        return json.load(r)["response"].strip()
    except Exception:
        return None


def safe_name(name: str) -> str:
    name = re.sub(r"[^\w.\- ]", "_", Path(name).name)[:120]
    if Path(name).suffix.lower() not in AUDIO_EXT:
        raise ValueError("not an audio file")
    return name


def load_note(audio: Path) -> dict:
    meta = audio.with_suffix(audio.suffix + ".json")
    d = json.loads(meta.read_text("utf-8")) if meta.exists() else {}
    return {"name": audio.name, **d}


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json", headers=()):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def foreign(self) -> bool:
        """Block other websites (DNS rebinding / cross-site POSTs) from reading or adding notes."""
        ok = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        origin = self.headers.get("Origin")
        bad = self.headers.get("Host") not in ok or (origin and origin.split("//")[-1].rstrip("/") not in ok)
        if bad:
            self.send(403, {"error": "forbidden"})
        return bool(bad)

    def do_GET(self):
        if self.foreign():
            return
        if self.path == "/":
            return self.send(200, PAGE, "text/html; charset=utf-8")
        if self.path == "/notes":
            files = sorted((p for p in NOTES.iterdir() if p.suffix.lower() in AUDIO_EXT),
                           key=lambda p: p.stat().st_mtime, reverse=True)
            return self.send(200, [load_note(p) for p in files])
        if self.path.startswith("/audio/"):
            try:
                p = NOTES / safe_name(urllib.request.unquote(self.path[7:]))
                data, ctype = p.read_bytes(), "audio/ogg" if p.suffix.lower() in (".opus", ".ogg") else "audio/mpeg"
                rng = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
                if not rng or not data:  # Range support lets the player seek in long notes
                    return self.send(200, data, ctype, [("Accept-Ranges", "bytes")])
                start = int(rng[1] or 0)
                end = min(int(rng[2] or len(data) - 1), len(data) - 1)
                if start > end:
                    return self.send(416, b"", ctype, [("Content-Range", f"bytes */{len(data)}")])
                return self.send(206, data[start:end + 1], ctype,
                                 [("Accept-Ranges", "bytes"), ("Content-Range", f"bytes {start}-{end}/{len(data)}")])
            except (ValueError, FileNotFoundError):
                return self.send(404, {"error": "not found"})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.foreign():
            return
        if self.path != "/transcribe":
            return self.send(404, {"error": "not found"})
        path = None
        try:
            name = safe_name(urllib.request.unquote(self.headers.get("X-Filename", "")))
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 500_000_000:
                raise ValueError("file empty or over 500 MB")
            path, n = NOTES / name, 1
            while path.exists():  # never overwrite an earlier note with the same name
                path, n = NOTES / f"{Path(name).stem} ({n}){Path(name).suffix}", n + 1
            with path.open("wb") as f:  # stream to disk in 1 MB chunks instead of holding it all in RAM
                left = size
                while left:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        raise ValueError("upload was cut short")
                    f.write(chunk)
                    left -= len(chunk)
            result = transcribe(path)
            result["summary"] = summarize(result["english"] or result["text"])
            path.with_suffix(path.suffix + ".json").write_text(json.dumps(result, ensure_ascii=False), "utf-8")
            self.send(200, {"name": path.name, **result})
        except ValueError as e:
            self.send(400, {"error": str(e)})
        except Exception as e:
            err = {"error": f"transcription failed: {e}"}
            if path and path.exists():  # so the page shows the failure instead of "Transcribing…" forever
                path.with_suffix(path.suffix + ".json").write_text(json.dumps(err), "utf-8")
            self.send(500, err)

    def log_message(self, *a):
        pass


PAGE = """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Voice Notes</title><style>
:root{--bg:#f4f6f5;--card:#fff;--fg:#1b1f1d;--muted:#5d6b64;--acc:#128c7e;--line:#dde3e0}
@media(prefers-color-scheme:dark){:root{--bg:#111b21;--card:#1f2c33;--fg:#e9edef;--muted:#8696a0;--acc:#25d366;--line:#2a3942}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 18px}
#drop{display:block;border:2px dashed var(--acc);border-radius:12px;padding:28px;text-align:center;cursor:pointer;background:var(--card)}
#drop.over{background:color-mix(in srgb,var(--acc) 12%,var(--card))}
.note{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:14px}
.note h3{font-size:14px;margin:0 0 8px;word-break:break-all}.meta{color:var(--muted);font-size:13px}
audio{width:100%;margin:6px 0}.sum{border-left:3px solid var(--acc);padding-left:10px;white-space:pre-wrap;margin-top:8px}
button{background:none;border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:2px 10px;cursor:pointer;font-size:13px}
</style></head><body><main>
<h1>WhatsApp voice notes</h1><p class=sub>Runs on this PC only. On your phone: hold the voice note → Share → save or send it to this PC, then drop it here.</p>
<label id=drop>Drop voice notes here, or click to choose<input type=file id=pick accept="audio/*,.opus" multiple hidden></label>
<div id=list></div></main><script>
const list=document.getElementById('list'),drop=document.getElementById('drop');
const esc=s=>(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function card(n){const d=document.createElement('div');d.className='note';
 d.innerHTML=`<h3>${esc(n.name)}</h3><audio controls preload=none src="/audio/${encodeURIComponent(n.name)}"></audio>
 <div class=meta>${n.error?'⚠ '+esc(n.error):n.text==null?(n.pending?'Transcribing…':'No transcript yet. Drop the file again.'):`${n.seconds}s · ${esc(n.language)} <button>Copy</button>`}</div>
 ${n.text?`<p>${esc(n.text)}</p>`:''}${n.english?`<p><b>English:</b> ${esc(n.english)}</p>`:''}${n.summary?`<div class=sum>${esc(n.summary)}</div>`:''}`;
 d.querySelector('button')?.addEventListener('click',()=>navigator.clipboard.writeText(n.text));return d}
async function upload(f){const ph=card({name:f.name,pending:1});list.prepend(ph);
 try{const r=await fetch('/transcribe',{method:'POST',headers:{'X-Filename':encodeURIComponent(f.name)},body:f});
  ph.replaceWith(card(await r.json().then(j=>({name:f.name,...j}))))}catch(e){ph.replaceWith(card({name:f.name,error:e.message}))}}
const go=fs=>[...fs].reduce((p,f)=>p.then(()=>upload(f)),Promise.resolve());
document.getElementById('pick').onchange=e=>go(e.target.files);
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');go(e.dataTransfer.files)};
fetch('/notes').then(r=>r.json()).then(ns=>ns.forEach(n=>list.append(card(n))));
</script></body></html>"""

if __name__ == "__main__" and len(sys.argv) > 1:  # CLI mode, used by the Claude skill (Claude does the revising)
    for f in sys.argv[1:]:
        try:
            r = transcribe(Path(f))
        except Exception as e:
            r = {"error": str(e)}
        print(json.dumps({"file": f, **r}, ensure_ascii=False, indent=1), flush=True)
elif __name__ == "__main__":
    threading.Thread(target=model, daemon=True).start()  # warm the model while the page loads
    print(f"Open http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
