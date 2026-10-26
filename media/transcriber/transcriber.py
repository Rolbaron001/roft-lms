"""
The LMS classroom's transcriber (job sheet D41, phase B).

Runs on the media server beside LiveKit and its recorder. The LMS sends it a
class: one voice file per person, each with who it is and when the recording
started. It transcribes each file with Whisper (the faster-whisper build, on
the processor), puts every line at the moment it was said, and posts the
transcript back to the LMS. Voices never leave this server, and the LMS asks
for them to be deleted once the facilitator publishes the notes.

One class at a time, in the order they arrive: a two-hour class takes the
processor for a while, and classes ending together simply wait their turn.

    TRANSCRIBER_SECRET  shared with the LMS; required both ways
    RECORDINGS_DIR      where the recorder writes voice files (default /recordings)
    WHISPER_MODEL       tiny, base, small (default), medium or large-v3
    WHISPER_LANGUAGE    e.g. "en"; empty to detect each file's language
    WHISPER_THREADS     processor threads; default all
    PORT                default 8790

    POST   /jobs              {job, callback, files: [{path, speaker, startedAt}]}
    DELETE /jobs/<job>/audio  {paths: [...]}
    GET    /health
"""

import hmac
import json
import os
import queue
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SECRET = os.environ.get("TRANSCRIBER_SECRET", "")
RECORDINGS = Path(os.environ.get("RECORDINGS_DIR", "/recordings")).resolve()
MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
LANGUAGE = os.environ.get("WHISPER_LANGUAGE") or None
THREADS = int(os.environ.get("WHISPER_THREADS", "0") or 0)
PORT = int(os.environ.get("PORT", "8790"))

jobs: "queue.Queue[dict]" = queue.Queue()
_model = None


def log(message: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}  {message}", flush=True)


def model():
    """Loaded on the first class rather than at start, so the service is up at once."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        log(f"Loading the {MODEL_NAME} model...")
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=THREADS)
        log("Model loaded.")
    return _model


def inside(path: str) -> bool:
    """Only files under the recordings folder are ever read or deleted."""
    try:
        resolved = Path(path).resolve()
    except (OSError, ValueError):
        return False
    return RECORDINGS in resolved.parents


def authorised(header: str | None) -> bool:
    given = (header or "").removeprefix("Bearer ").strip()
    return bool(SECRET) and hmac.compare_digest(given, SECRET)


def instant(base: datetime, seconds: float) -> str:
    return (base + timedelta(seconds=seconds)).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def transcribe(job: dict) -> list[dict]:
    lines: list[dict] = []
    for item in job["files"]:
        path = item["path"]
        if not Path(path).exists():
            log(f"  {path}: not found, skipped")
            continue
        base = datetime.fromisoformat(item["startedAt"].replace("Z", "+00:00"))
        segments, info = model().transcribe(path, language=LANGUAGE, vad_filter=True, beam_size=5)
        count = 0
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            lines.append({"speaker": item["speaker"], "startedAt": instant(base, segment.start), "endedAt": instant(base, segment.end), "text": text})
            count += 1
        log(f"  {Path(path).name}: {count} lines, language {info.language}")
    return lines


def answer(job: dict, body: dict) -> None:
    """Posted back to the LMS, tried three times before giving up."""
    data = json.dumps({"job": job["job"], **body}).encode()
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                job["callback"],
                data=data,
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {SECRET}"},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                log(f"  LMS answered {response.status}")
                return
        except Exception as error:  # noqa: BLE001 - any failure is retried
            log(f"  Could not reach the LMS ({error}); attempt {attempt + 1} of 3")
            time.sleep(10 * (attempt + 1))


def worker() -> None:
    while True:
        job = jobs.get()
        started = time.time()
        log(f"Transcribing {job['job']}: {len(job['files'])} voices")
        try:
            lines = transcribe(job)
            log(f"Done in {time.time() - started:.0f}s: {len(lines)} lines")
            answer(job, {"status": "done", "segments": lines})
        except Exception as error:  # noqa: BLE001 - reported to the LMS rather than lost
            log(f"Failed: {error}")
            answer(job, {"status": "failed", "error": str(error)[:500]})
        finally:
            jobs.task_done()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        if self.path == "/health":
            self.reply(200, {"ok": True, "waiting": jobs.qsize(), "model": MODEL_NAME})
        else:
            self.reply(404, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/jobs":
            return self.reply(404, {"error": "Not found."})
        if not authorised(self.headers.get("Authorization")):
            return self.reply(401, {"error": "Not permitted."})
        try:
            job = self.body()
            files = [f for f in job.get("files", []) if inside(str(f.get("path", "")))]
            if not job.get("job") or not job.get("callback") or not files:
                return self.reply(400, {"error": "A job needs its name, a callback and at least one voice file in the recordings folder."})
            jobs.put({"job": str(job["job"]), "callback": str(job["callback"]), "files": files})
            self.reply(202, {"ok": True, "waiting": jobs.qsize()})
        except (ValueError, KeyError) as error:
            self.reply(400, {"error": str(error)})

    def do_DELETE(self) -> None:  # noqa: N802
        if not (self.path.startswith("/jobs/") and self.path.endswith("/audio")):
            return self.reply(404, {"error": "Not found."})
        if not authorised(self.headers.get("Authorization")):
            return self.reply(401, {"error": "Not permitted."})
        deleted = 0
        for path in self.body().get("paths", []):
            if not inside(str(path)):
                continue
            target = Path(path)
            if target.exists():
                target.unlink()
                deleted += 1
            # The class's own folder goes once it is empty.
            try:
                target.parent.rmdir()
            except OSError:
                pass
        log(f"Deleted {deleted} voice files for {self.path.split('/')[2]}")
        self.reply(200, {"ok": True, "deleted": deleted})

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - quieter than the default
        pass


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("Set TRANSCRIBER_SECRET.")
    threading.Thread(target=worker, daemon=True).start()
    log(f"Transcriber on port {PORT}, model {MODEL_NAME}, recordings in {RECORDINGS}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
