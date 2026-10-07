"""Real upstream AIAgent loop against an OpenAI-compatible simulated endpoint.

This is an integration test, never live evidence. No provider key is required.
"""
import concurrent.futures
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

from server import isolated_run


class Endpoint(BaseHTTPRequestHandler):
    calls = []
    lock = threading.Lock()

    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        token = self.headers.get("Authorization", "")
        with self.lock:
            self.calls.append((self.path, token))
        if self.path == '/agent/api/show':
            self.send_error(404)  # Hermes local-provider metadata probe: no inference.
            return
        if self.path.startswith("/agent/tools/"):
            output = {"state": "present", "reference": f"fixture:{token[-3:]}", "content": "Sources fictives isolées"}
        else:
            names = [t["function"]["name"] for t in body.get("tools", [])]
            if names:
                self.assert_tools(names)
            print(json.dumps({"path": self.path, "model": body.get("model"), "tools": names, "roles": [m.get("role") for m in body.get("messages", [])]}), flush=True)
            if not any(m.get("role") == "tool" for m in body["messages"]):
                message = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_fixture", "type": "function", "function": {"name": "get_opportunity", "arguments": json.dumps({"subjectId": str(uuid4())})}}]}
                finish = "tool_calls"
            else:
                message = {"role": "assistant", "content": json.dumps({"version": "ulysse-agent-v1", "outcome": "abstained", "summary": f"Simulation Hermes pour {token[-3:]}", "proposals": []})}
                finish = "stop"
            output = {"id": "simulated-completion", "object": "chat.completion", "created": 1, "model": "openai/gpt-4.1-mini", "choices": [{"index": 0, "message": message, "finish_reason": finish}], "usage": {"prompt_tokens": 100, "completion_tokens": 50}}
        data = json.dumps(output).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    @staticmethod
    def assert_tools(names):
        expected = {"get_opportunity", "list_activities", "search_documents", "read_document_excerpt", "get_company_context", "get_active_doctrine", "list_related_recommendations"}
        if set(names) != expected:
            raise AssertionError(f"unexpected tools: {names}")


class HermesIntegration(unittest.TestCase):
    def test_real_loop_uses_custom_tools_and_isolates_two_processes(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Endpoint)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        os.environ["ULYSSE_GATEWAY_URL"] = f"http://127.0.0.1:{server.server_port}/agent"
        requests = [{"runId": str(uuid4()), "subjectId": str(uuid4()), "capability": token, "mode": "hermes-live", "model": "openai/gpt-4.1-mini", "timeoutMs": 30000} for token in ["a" * 43, "b" * 43]]
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(isolated_run, requests))
            self.assertEqual([r["outcome"] for r in results], ["abstained", "abstained"])
            self.assertIn("aaa", results[0]["summary"])
            self.assertIn("bbb", results[1]["summary"])
            for token in ["a" * 43, "b" * 43]:
                calls = [path for path, authorization in Endpoint.calls if authorization == f"Bearer {token}"]
                self.assertIn("/agent/tools/get_opportunity", calls)
                self.assertGreaterEqual(calls.count("/agent/v1/chat/completions"), 2)
        finally:
            server.shutdown()
            server.server_close()
            os.environ.pop("ULYSSE_GATEWAY_URL", None)


if __name__ == "__main__":
    unittest.main()
