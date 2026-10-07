"""Private authenticated process supervisor; no tenant state in shared globals."""
import hmac
import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID

SLOTS = threading.BoundedSemaphore(2)


def isolated_run(request):
    UUID(request["runId"])
    UUID(request["subjectId"])
    if request["mode"] != "hermes-live" or request["model"] != "openai/gpt-4.1-mini":
        raise ValueError("unsupported_execution")
    if not isinstance(request["capability"], str) or len(request["capability"]) != 43:
        raise ValueError("invalid_capability")
    with tempfile.TemporaryDirectory(prefix="ulysse-run-") as home:
        # Sealed child environment: no user config, provider secret or global tenant env.
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "PYTHONPATH": "/opt/hermes", "PYTHONDONTWRITEBYTECODE": "1",
            "HERMES_HOME": home, "XDG_CONFIG_HOME": home, "XDG_CACHE_HOME": home,
            "ULYSSE_GATEWAY_URL": os.environ.get("ULYSSE_GATEWAY_URL", "http://worker:3001/agent"),
            "HERMES_TELEMETRY_ENABLED": "false", "DO_NOT_TRACK": "1",
        }
        Path(home, "config.yaml").write_text(
            "telemetry:\n  enabled: false\ncompression:\n  enabled: false\n"
            "tools:\n  tool_search:\n    enabled: off\n"
            "model:\n  streaming: false\n  context_length: 100000\n"
            "memory:\n  memory_enabled: false\n  user_profile_enabled: false\n",
            encoding="utf-8",
        )
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("runner.py"))],
            input=json.dumps(request), capture_output=True, text=True, env=env, cwd=home,
            timeout=min(int(request.get("timeoutMs", 90000)), 90000) / 1000, check=False,
        )
        if completed.returncode:
            # Runner diagnostics contain class names and source locations only.
            diagnostic = json.loads(completed.stderr)
            raise RuntimeError(json.dumps(diagnostic))
        if len(completed.stdout) > 20000:
            raise ValueError("result_size")
        return json.loads(completed.stdout)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # No request bodies, capabilities or raw model output in logs.

    def send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.send(200 if self.path == "/health" else 404, {"status": "ok"})

    def do_POST(self):
        configured = os.environ.get("HERMES_SERVICE_TOKEN", "")
        if len(configured) < 32 or not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {configured}"):
            self.send(403, {"error": "unauthorized"})
            return
        if self.path != "/v1/runs":
            self.send(404, {"error": "not_found"})
            return
        if not SLOTS.acquire(blocking=False):
            self.send(429, {"error": "concurrency_limit"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 8192:
                raise ValueError("request_size")
            request = json.loads(self.rfile.read(size))
            self.send(200, isolated_run(request))
        except subprocess.TimeoutExpired:
            self.send(504, {"error": "execution_timeout"})
        except Exception:
            self.send(422, {"error": "hermes_execution_failed"})
        finally:
            SLOTS.release()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
