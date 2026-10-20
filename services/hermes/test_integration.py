"""Real upstream AIAgent loop against an OpenAI-compatible simulated endpoint.

This is an integration test, never live evidence. No provider key is required.
"""
import concurrent.futures
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

from server import isolated_run, model_settings


class Endpoint(BaseHTTPRequestHandler):
    calls = []
    systems = []
    replayed_reasoning = []
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
            workflow = "get_workflow_context" in names
            with self.lock:
                self.systems.append([m.get("content") for m in body["messages"] if m.get("role") in ("system", "developer")])
                if body.get("model") == "z-ai/glm-5.3-flash" and any(m.get("role") == "tool" for m in body["messages"]):
                    self.replayed_reasoning.append(any(
                        m.get("role") == "assistant" and m.get("tool_calls") and
                        (m.get("reasoning") == "fixture-reasoning" or m.get("reasoning_content") == "fixture-reasoning" or
                         any(r.get("text") == "fixture-reasoning" for r in m.get("reasoning_details", [])))
                        for m in body["messages"]))
            print(json.dumps({"path": self.path, "model": body.get("model"), "tools": names, "roles": [m.get("role") for m in body.get("messages", [])]}), flush=True)
            if not any(m.get("role") == "tool" for m in body["messages"]):
                message = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_fixture", "type": "function", "function": {"name": "get_workflow_context" if workflow else "get_opportunity", "arguments": json.dumps({} if workflow else {"subjectId": str(uuid4())})}}]}
                finish = "tool_calls"
                if body.get("model") == "z-ai/glm-5.3-flash":
                    message["reasoning"] = "fixture-reasoning"
                    message["reasoning_details"] = [{"type": "reasoning.text", "text": "fixture-reasoning", "format": "unknown", "index": 0}]
            else:
                message = {"role": "assistant", "content": json.dumps({"version": "november-v1" if workflow else "ulysse-agent-v1", "outcome": "abstained", "summary": f"Simulation Hermes pour {token[-3:]}", "proposals": []})}
                finish = "stop"
            output = {"id": "simulated-completion", "object": "chat.completion", "created": 1, "model": body.get("model"), "choices": [{"index": 0, "message": message, "finish_reason": finish}], "usage": {"prompt_tokens": 100, "completion_tokens": 50}}
        data = json.dumps(output).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    @staticmethod
    def assert_tools(names):
        expected = {"get_opportunity", "list_activities", "search_documents", "read_document_excerpt", "get_company_context", "get_active_doctrine", "list_related_recommendations"}
        workflow = {"get_workflow_context", "list_company_sources", "read_company_source"}
        if set(names) not in (expected, workflow):
            raise AssertionError(f"unexpected tools: {names}")


class ModelSettings(unittest.TestCase):
    def test_settings_are_model_independent_and_bounded(self):
        request = {"model": "example/next-model", "modelSettings": {"maxOutputTokens": 8192, "reasoning": "low"}}
        self.assertEqual(model_settings(request), request["modelSettings"])
        for settings in ({"maxOutputTokens": 999999, "reasoning": "low"},
                         {"maxOutputTokens": True, "reasoning": "low"},
                         {"maxOutputTokens": 3000, "reasoning": "invalid"},
                         {"maxOutputTokens": 3000, "reasoning": "low", "base_url": "https://example.com"}):
            with self.assertRaises(ValueError): model_settings({**request, "modelSettings": settings})
        for model in ("https://example.com/model", "@preset/test", "x\n/y", None):
            with self.assertRaises(ValueError): model_settings({**request, "model": model})


class FinalResponse(unittest.TestCase):
    def test_only_a_surrounding_code_fence_is_tolerated(self):
        from runner import parse_final
        closed = {"version": "ulysse-agent-v1", "outcome": "abstained", "summary": "s", "proposals": []}
        self.assertEqual(parse_final(json.dumps(closed)), closed)
        self.assertEqual(parse_final("```json\n" + json.dumps(closed) + "\n```"), closed)
        for invalid in ("Voici le résultat : " + json.dumps(closed), "[]", None, "x" * 20001):
            with self.assertRaises(RuntimeError):
                parse_final(invalid)


class HermesIntegration(unittest.TestCase):
    def setUp(self):
        Endpoint.calls = []
        Endpoint.systems = []
        Endpoint.replayed_reasoning = []

    def test_workflows_select_their_own_tools(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Endpoint)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        os.environ["ULYSSE_GATEWAY_URL"] = f"http://127.0.0.1:{server.server_port}/agent"
        try:
            for kind in ("buyer", "content"):
                request = {"runId": str(uuid4()), "subjectId": str(uuid4()), "capability": "w" * 43, "mode": "hermes-live", "model": "z-ai/glm-5.3-flash", "modelSettings": {"maxOutputTokens": 8192, "reasoning": "low"}, "timeoutMs": 30000, "workflow": kind}
                result = isolated_run(request)
                self.assertEqual(result["version"], "november-v1")
                self.assertEqual(result["outcome"], "abstained")
                instructions = Path(__file__).with_name("workflows.txt").read_text(encoding="utf-8")
                self.assertTrue(Endpoint.systems)
                self.assertTrue(all(system == [instructions] for system in Endpoint.systems))
            self.assertTrue(Endpoint.replayed_reasoning)
            self.assertTrue(all(Endpoint.replayed_reasoning), "Hermes must preserve reasoning across tool calls")
        finally:
            server.shutdown()
            server.server_close()
            os.environ.pop("ULYSSE_GATEWAY_URL", None)

    def test_real_loop_uses_custom_tools_and_isolates_two_processes(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Endpoint)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        os.environ["ULYSSE_GATEWAY_URL"] = f"http://127.0.0.1:{server.server_port}/agent"
        requests = [{"runId": str(uuid4()), "subjectId": str(uuid4()), "capability": token, "mode": "hermes-live", "model": model, "timeoutMs": 30000} for token, model in [("a" * 43, "openai/gpt-4.1-mini"), ("b" * 43, "anthropic/claude-haiku-5.5")]]
        requests.append({"runId": str(uuid4()), "subjectId": str(uuid4()), "capability": "c" * 43, "mode": "hermes-live", "model": "example/next-model", "modelSettings": {"maxOutputTokens": 8192, "reasoning": "low"}, "timeoutMs": 30000})
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(isolated_run, requests))
            self.assertEqual([r["outcome"] for r in results], ["abstained"] * 3)
            self.assertIn("aaa", results[0]["summary"])
            self.assertIn("bbb", results[1]["summary"])
            for token in ["a" * 43, "b" * 43, "c" * 43]:
                calls = [path for path, authorization in Endpoint.calls if authorization == f"Bearer {token}"]
                self.assertIn("/agent/tools/get_opportunity", calls)
                self.assertGreaterEqual(calls.count("/agent/v1/chat/completions"), 2)
            # The model receives the versioned Ulysse instructions only: no generic Hermes identity,
            # coding guidance, host details or out-of-band steering channel.
            instructions = Path(__file__).with_name("instructions.txt").read_text(encoding="utf-8")
            self.assertGreaterEqual(len(Endpoint.systems), 4)
            for system in Endpoint.systems:
                self.assertEqual(system, [instructions])
        finally:
            server.shutdown()
            server.server_close()
            os.environ.pop("ULYSSE_GATEWAY_URL", None)


if __name__ == "__main__":
    unittest.main()
