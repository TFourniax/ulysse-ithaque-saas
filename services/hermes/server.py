"""Private authenticated process supervisor; no tenant state in shared globals."""
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID

SLOTS = threading.BoundedSemaphore(2)
MODES = {"hermes-live", "hermes-stub"}
_pinned = Path(os.environ.get("HERMES_SOURCE", "/opt/hermes"), ".ulysse-pinned-commit")
PINNED_COMMIT = _pinned.read_text(encoding="utf-8").strip() if _pinned.exists() else "unknown"
INSTRUCTIONS_SHA256 = hashlib.sha256(Path(__file__).with_name("instructions.txt").read_bytes()).hexdigest()
# Upstream configuration only: generic agent guidance, probes, memory, compression,
# progressive tool discovery and streaming are off; only the Ulysse plugin is enabled.
CONFIG = """telemetry:
  enabled: false
compression:
  enabled: false
tools:
  tool_search:
    enabled: off
model:
  streaming: false
  context_length: 100000
memory:
  memory_enabled: false
  user_profile_enabled: false
agent:
  tool_use_enforcement: false
  execution_guidance: false
  task_completion_guidance: false
  parallel_tool_call_guidance: false
  stall_guards: false
  environment_probe: false
  bot_mode_protocol: false
plugins:
  enabled:
    - ulysse
"""


def isolated_run(request):
    UUID(request["runId"])
    UUID(request["subjectId"])
    # hermes-stub: the real Hermes loop against the stack's simulated model endpoint (CI and
    # local acceptance). The worker gateway, not this service, decides which provider is called.
    if request["mode"] not in MODES or request["model"] != "openai/gpt-4.1-mini":
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
        Path(home, "config.yaml").write_text(CONFIG, encoding="utf-8")
        # The only enabled plugin: Ulysse tools and the Ulysse-only system prompt.
        shutil.copytree(Path(__file__).with_name("plugin") / "ulysse", Path(home, "plugins", "ulysse"))
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


def log(event, detail=None):
    sys.stderr.write(json.dumps({"service": "ulysse-hermes", "event": event, "detail": detail}) + "\n")
    sys.stderr.flush()


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
        if self.path != "/health":
            self.send(404, {"error": "not_found"})
            return
        # The worker refuses to start a run when these differ from what it expects.
        self.send(200, {"status": "ok", "hermesCommit": PINNED_COMMIT, "instructionsSha256": INSTRUCTIONS_SHA256})

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
            log("execution_timeout")
            self.send(504, {"error": "execution_timeout"})
        except Exception as error:
            # Runner diagnostics are class names, fixed reasons and source locations only.
            log("execution_failed", str(error)[:500])
            self.send(422, {"error": "hermes_execution_failed"})
        finally:
            SLOTS.release()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
