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

from server import isolated_run, model_settings, initial_evidence


class Endpoint(BaseHTTPRequestHandler):
    calls = []
    systems = []
    replayed_reasoning = []
    models = []
    lock = threading.Lock()
    reasoning_fixture = [{"type": "reasoning.text", "text": "fixture-reasoning", "format": "unknown", "index": 0},
                         {"type": "reasoning.encrypted", "data": "opaque-fixture-signature", "format": "unknown", "index": 1}]

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
            self.models.append(body.get("model"))
            if token.endswith('fff') and body.get('model') == 'z-ai/glm-5.3-flash' and any(m.get('role') == 'tool' for m in body.get('messages', [])):
                data = json.dumps({'error': {'code': 429, 'type': 'rate_limit_error', 'message': 'provider temporarily unavailable'}}).encode()
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Retry-After', '1')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            names = [t["function"]["name"] for t in body.get("tools", [])]
            if names:
                self.assert_tools(names)
            workflow = "get_workflow_context" in names
            with self.lock:
                self.systems.append([m.get("content") for m in body["messages"] if m.get("role") in ("system", "developer")])
                if body.get("model") == "z-ai/glm-5.3-flash" and any(m.get("role") == "tool" for m in body["messages"]):
                    self.replayed_reasoning.append(any(
                        m.get("role") == "assistant" and m.get("tool_calls") and
                        m.get("reasoning") == "fixture-reasoning" and m.get("reasoning_details") == self.reasoning_fixture
                        for m in body["messages"]))
            print(json.dumps({"path": self.path, "model": body.get("model"), "tools": names, "roles": [m.get("role") for m in body.get("messages", [])]}), flush=True)
            if not any(m.get("role") == "tool" for m in body["messages"]):
                message = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_fixture", "type": "function", "function": {"name": "get_workflow_context" if workflow else "get_opportunity", "arguments": json.dumps({} if workflow else {"subjectId": str(uuid4())})}}]}
                finish = "tool_calls"
                if body.get("model") == "z-ai/glm-5.3-flash":
                    message["reasoning"] = "fixture-reasoning"
                    message["reasoning_details"] = self.reasoning_fixture
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


class NativeEndpoint(BaseHTTPRequestHandler):
    calls = []
    bodies = []
    failures = []
    large_tool_result = False

    def log_message(self, *_args):
        pass

    def do_POST(self):
        from model_stub import native_to_fixture, native_response
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.calls.append((self.path, self.headers.get('x-api-key'), self.headers.get('Authorization')))
        try:
            if self.path.startswith('/agent/tools/'):
                output = {'state': 'present', 'reference': 'fixture:native', 'content': 'é' * 30000 if self.large_tool_result else 'Native fixture'}
            else:
                if self.path != '/agent/v1/messages': raise ValueError('wrong protocol path')
                self.bodies.append(body)
                adapted = native_to_fixture(body)  # asserts exact signed interleaving on replay
                names = [t['name'] for t in body.get('tools', [])]
                Endpoint.assert_tools(names)
                workflow = 'get_workflow_context' in names
                if not any(m['role'] == 'tool' for m in adapted['messages']):
                    selected = ['get_workflow_context', 'list_company_sources'] if workflow else ['get_company_context', 'get_active_doctrine']
                    message = {'tool_calls': [{'id': f'fixture_{i}', 'function': {'name': n, 'arguments': '{}'}} for i, n in enumerate(selected)]}
                else:
                    message = {'content': json.dumps({'version': 'november-v1' if workflow else 'ulysse-agent-v1', 'outcome': 'abstained', 'summary': 'Native fixture', 'proposals': []})}
                output = native_response({'model': body['model'], 'choices': [{'message': message}]}, body)
            status = 200
        except Exception as error:
            self.failures.append(type(error).__name__)
            output = {'error': {'type': 'invalid_request_error', 'message': 'native fixture rejected'}}
            status = 400
        data = json.dumps(output).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ModelSettings(unittest.TestCase):
    def test_initial_native_evidence_is_required_bounded_and_not_available_to_other_routes(self):
        request = {'workflow': 'buyer', 'modelSettings': {'protocol': 'anthropic-messages'}}
        evidence = 'ULYSSE_WORKFLOW_EVIDENCE_V1\n' + json.dumps({'untrusted': True})
        self.assertEqual(initial_evidence({**request, 'initialEvidence': evidence}), evidence)
        for value in (None, 1, 'instruction', evidence + 'x' * 80000):
            with self.assertRaises(ValueError): initial_evidence({**request, 'initialEvidence': value})
        with self.assertRaises(ValueError): initial_evidence({'initialEvidence': evidence})

    def test_native_fixture_rejects_prefix_edits_but_accepts_cache_hints(self):
        from model_stub import native_to_fixture, native_response
        import copy
        request = {'model': 'claude-sonnet-5-5', 'system': 'Instructions',
                   'tools': [{'name': 'list_company_sources', 'input_schema': {'type': 'object'}}],
                   'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': 'Immutable evidence'}]}]}
        response = native_response({'choices': [{'message': {'tool_calls': [{'id': 'fixture', 'function': {'name': 'list_company_sources', 'arguments': '{}'}}]}}]}, request)
        continuation = {**request, 'messages': [*request['messages'], {'role': 'assistant', 'content': response['content']},
                        {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'fixture', 'content': 'New data'}]}]}
        native_to_fixture(continuation)
        cached = copy.deepcopy(continuation)
        cached['messages'][0]['content'][0]['cache_control'] = {'type': 'ephemeral'}
        native_to_fixture(cached)
        shorthand = copy.deepcopy(continuation)
        shorthand['messages'][0]['content'] = 'Immutable evidence'
        native_to_fixture(shorthand)
        for target in ('system', 'tools', 'messages'):
            changed = copy.deepcopy(continuation)
            if target == 'system': changed['system'] += 'Changed'
            elif target == 'tools': changed['tools'] = []
            else: changed['messages'][0]['content'][0]['text'] = 'Shrunk evidence catalog'
            with self.assertRaises(ValueError): native_to_fixture(changed)

    def test_native_anthropic_settings_reject_cross_protocol_fallback(self):
        request = {'model': 'claude-sonnet-5-5', 'modelSettings': {'protocol': 'anthropic-messages', 'maxOutputTokens': 16384, 'reasoning': 'medium'}}
        self.assertEqual(model_settings(request), request['modelSettings'])
        for extra in ({'fallbackModel': 'example/backup', 'workflow': 'buyer'}, {'model': 'example/other'}):
            with self.assertRaises(ValueError): model_settings({**request, **extra})
    def test_execution_deadlines_are_bounded_and_workflows_allow_provider_backoff(self):
        from server import execution_timeout_ms
        for workflow, maximum in (("deal", 90000), ("buyer", 300000), ("content", 300000)):
            self.assertEqual(execution_timeout_ms({"workflow": workflow}), maximum)
            self.assertEqual(execution_timeout_ms({"workflow": workflow, "timeoutMs": 999999}), maximum)
            self.assertEqual(execution_timeout_ms({"workflow": workflow, "timeoutMs": 30000}), 30000)
        for value in (True, -1, 0, "180000"):
            with self.assertRaises(ValueError):
                execution_timeout_ms({"workflow": "buyer", "timeoutMs": value})

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
        for fallback in ("https://example.com/model", request['model'], {'base_url': 'https://example.com'}):
            with self.assertRaises(ValueError):
                model_settings({**request, 'workflow': 'buyer', 'fallbackModel': fallback})
        with self.assertRaises(ValueError):
            model_settings({**request, 'fallbackModel': 'example/backup'})


class ReasoningContinuity(unittest.TestCase):
    def test_switch_discards_previous_model_reasoning_but_keeps_new_model_signatures(self):
        from reasoning_replay import ReasoningReplay
        replay = ReasoningReplay()
        call = {'id': 'first', 'function': {'name': 'get_workflow_context'}}
        message = {'role': 'assistant', 'content': None, 'tool_calls': [call], 'reasoning_details': [{'data': 'primary-only'}]}
        replay(request={'model': 'primary', 'messages': []}, next_call=lambda _: {'choices': [{'message': message}]})
        seen = []
        second = {'role': 'assistant', 'tool_calls': [{'id': 'second', 'function': {'name': 'read_company_source'}}], 'reasoning_details': [{'data': 'backup-only'}]}
        def capture(request):
            seen.append(request)
            return {'choices': [{'message': second}]}
        replay(request={'model': 'backup', 'messages': [message]}, next_call=capture)
        self.assertNotIn('reasoning_details', seen[-1]['messages'][0])
        replay(request={'model': 'backup', 'messages': [message, {k: v for k, v in second.items() if k != 'reasoning_details'}]}, next_call=capture)
        self.assertNotIn('reasoning_details', seen[-1]['messages'][0])
        self.assertEqual(seen[-1]['messages'][1]['reasoning_details'], second['reasoning_details'])

    def test_exact_replay_is_isolated_bounded_and_does_not_retry(self):
        from reasoning_replay import ReasoningReplay
        replay = ReasoningReplay()
        calls = [{"id": "call-1", "type": "function", "function": {"name": "read_company_source", "arguments": "{}"}}]
        message = {"role": "assistant", "content": None, "tool_calls": calls,
                   "reasoning": "fixture-reasoning", "reasoning_details": Endpoint.reasoning_fixture}
        response = {"choices": [{"message": message}]}
        self.assertIs(replay(request={"messages": []}, next_call=lambda _r: response), response)
        sent = {"messages": [{"role": "assistant", "content": None, "tool_calls": calls}]}
        seen = []
        def capture(request):
            seen.append(request)
            return {"choices": []}
        replay(request=sent, next_call=capture)
        self.assertEqual(seen[-1]["messages"][0], message)
        self.assertNotIn("reasoning", sent["messages"][0])
        ReasoningReplay()(request=sent, next_call=capture)
        self.assertNotIn("reasoning", seen[-1]["messages"][0])
        count = 0
        def fail(_request):
            nonlocal count
            count += 1
            raise ConnectionError("fixture")
        with self.assertRaises(ConnectionError): replay(request=sent, next_call=fail)
        self.assertEqual(count, 1)
        oversized = {"choices": [{"message": {**message, "reasoning": "x" * 80001}}]}
        replay(request=sent, next_call=lambda _r: oversized)
        self.assertTrue(replay.failed)


class FinalResponse(unittest.TestCase):
    def test_only_a_surrounding_code_fence_is_tolerated(self):
        from runner import parse_final
        closed = {"version": "ulysse-agent-v1", "outcome": "abstained", "summary": "s", "proposals": []}
        self.assertEqual(parse_final(json.dumps(closed)), closed)
        self.assertEqual(parse_final("```json\n" + json.dumps(closed) + "\n```"), closed)
        for invalid in ("Voici le résultat : " + json.dumps(closed), "[]", None, "x" * 20001):
            with self.assertRaises(RuntimeError):
                parse_final(invalid)


class WorkflowEvidence(unittest.TestCase):
    def test_stub_repairs_the_latest_review_without_replaying_the_original_draft(self):
        from model_stub import _workflow_step, respond
        sources = [dict(id=str(uuid4()), kind=kind, title=title, text="Fictional source text.", reference=f"source:{title}:r1")
                   for kind, title in [("offer", "own"), ("competitor", "rival-a"), ("competitor", "rival-b")]]
        evidence = {"context": {"kind": "buyer"}, "sources": sources, "untrusted": True}
        _, draft = _workflow_step([{"name": "list_company_sources", "args": {}, "result": {"items": sources}}], evidence)
        def messages(value):
            return [{"role": "system", "content": "Relecture fictive"},
                    {"role": "user", "content": "ULYSSE_WORKFLOW_EVIDENCE_V1\n" + json.dumps(evidence)},
                    {"role": "user", "content": "ULYSSE_BUYER_DRAFT_TO_REVIEW_V1\n" + json.dumps({"draft": value, "untrusted": True})}]
        first = json.loads(respond({"messages": messages(draft)})["choices"][0]["message"]["content"])
        self.assertTrue(all(len(row['references']) == 1 for row in first['benchmark']))
        repair = messages(first) + [{"role": "user", "content": "Ulysse a refusé les références du diagnostic : correction de fixture."}]
        self.assertFalse(any(m['role'] == 'assistant' for m in repair))
        corrected = json.loads(respond({"messages": repair})["choices"][0]["message"]["content"])
        self.assertEqual(corrected['benchmark'], draft['benchmark'])
        self.assertEqual(len(corrected['limits']), len(set(corrected['limits'])))

    def test_buyer_stub_exercises_separate_review_and_preserves_a_cited_draft(self):
        from model_stub import _workflow_step, respond
        source = {"id": str(uuid4()), "kind": "offer", "text": "Service fictif avec accompagnement.", "reference": "source:fixture:r1"}
        evidence = {"context": {"kind": "buyer"}, "sources": [source], "untrusted": True}
        _, draft = _workflow_step([{"name": "list_company_sources", "args": {}, "result": {"items": [source]}}], evidence)
        self.assertEqual(draft["outcome"], "draft")
        messages = [{"role": "system", "content": "Relecture fictive"},
                    {"role": "user", "content": "ULYSSE_WORKFLOW_EVIDENCE_V1\n" + json.dumps(evidence)},
                    {"role": "user", "content": "ULYSSE_BUYER_DRAFT_TO_REVIEW_V1\n" + json.dumps({"draft": draft, "untrusted": True})}]
        reviewed = json.loads(respond({"messages": messages})["choices"][0]["message"]["content"])
        self.assertEqual(reviewed["outcome"], "draft")
        self.assertEqual(reviewed["findings"], draft['findings'])
        self.assertIn("Relecture séparée exécutée avec les preuves consultées.", reviewed["limits"])
        with self.assertRaises(ValueError):
            respond({"messages": messages, "tools": [{"function": {"name": name}} for name in ("get_workflow_context", "list_company_sources", "read_company_source")]})

    def test_simulated_429_happens_once_after_tools_and_is_isolated_by_workflow(self):
        from model_stub import transient_workflow_fixture
        for _ in range(2):
            evidence = {"context": {"references": [f"workflow:{uuid4()}"]}}
            body = {"response_format": {"type": "json_schema"}, "messages": [
                {"role": "user", "content": "ULYSSE_WORKFLOW_EVIDENCE_V1\n" + json.dumps(evidence)},
            ]}
            self.assertFalse(transient_workflow_fixture(body))
            body["messages"].append({"role": "tool", "content": "{}"})
            self.assertTrue(transient_workflow_fixture(body))
            self.assertFalse(transient_workflow_fixture(body))

    def test_prepared_sources_need_no_duplicate_read_but_competitors_still_do(self):
        from model_stub import _workflow_step
        sources = [{"id": str(uuid4()), "text": f"Source fictive {i}"} for i in range(8)]
        rival = {"id": str(uuid4())}
        evidence = {"context": {"kind": "buyer"}, "sources": sources, "untrusted": True}
        calls = [{"name": "list_company_sources", "args": {}, "result": {"items": [*sources, rival]}}]
        pending, result = _workflow_step(calls, evidence)
        self.assertIsNone(result)
        self.assertEqual(pending, [("read_company_source", {"sourceIds": [rival["id"]]})])
        calls.append({"name": "read_company_source", "args": {"sourceIds": [rival["id"]]}, "result": {"items": [rival]}})
        pending, result = _workflow_step(calls, evidence)
        self.assertEqual(pending, [])
        self.assertEqual(result["outcome"], "abstained")
        self.assertIn("Sources obligatoires fournies automatiquement.", result["limits"])


class HermesIntegration(unittest.TestCase):
    def test_native_long_tool_results_preserve_the_signed_conversation(self):
        NativeEndpoint.calls, NativeEndpoint.bodies, NativeEndpoint.failures = [], [], []
        NativeEndpoint.large_tool_result = True
        server = ThreadingHTTPServer(('127.0.0.1', 0), NativeEndpoint)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        os.environ['ULYSSE_GATEWAY_URL'] = f'http://127.0.0.1:{server.server_port}/agent'
        evidence = 'ULYSSE_WORKFLOW_EVIDENCE_V1\n' + json.dumps({'context': {'kind': 'buyer'}, 'sources': [{'text': 'fixture ' * 5000}], 'untrusted': True})
        try:
            result = isolated_run({'runId': str(uuid4()), 'subjectId': str(uuid4()), 'capability': 'l' * 43,
                                   'mode': 'hermes-stub', 'workflow': 'buyer', 'model': 'claude-sonnet-5-5', 'timeoutMs': 60000,
                                   'initialEvidence': evidence,
                                   'modelSettings': {'protocol': 'anthropic-messages', 'maxOutputTokens': 16384, 'reasoning': 'medium'}})
            self.assertEqual(result['outcome'], 'abstained')
            self.assertEqual(NativeEndpoint.failures, [])
            self.assertEqual(len(NativeEndpoint.bodies), 2)
            sizes = [len(json.dumps(b, ensure_ascii=False).encode()) for b in NativeEndpoint.bodies]
            self.assertLess(sizes[0], 80000)
            self.assertGreater(sizes[1], 100000)
            self.assertLess(sizes[1], 256000)
            for body in NativeEndpoint.bodies:
                first = body['messages'][0]['content']
                self.assertEqual(first if isinstance(first, str) else first[0]['text'], evidence)
        finally:
            NativeEndpoint.large_tool_result = False
            server.shutdown()
            server.server_close()
            os.environ.pop('ULYSSE_GATEWAY_URL', None)

    def test_native_anthropic_loop_preserves_signed_order_and_private_capabilities_for_all_workflows(self):
        NativeEndpoint.calls, NativeEndpoint.bodies, NativeEndpoint.failures = [], [], []
        server = ThreadingHTTPServer(('127.0.0.1', 0), NativeEndpoint)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        os.environ['ULYSSE_GATEWAY_URL'] = f'http://127.0.0.1:{server.server_port}/agent'
        try:
            for workflow in ('deal', 'buyer', 'content'):
                token = workflow[0] * 43
                request = {'runId': str(uuid4()), 'subjectId': str(uuid4()), 'capability': token,
                           'mode': 'hermes-stub', 'model': 'claude-sonnet-5-5', 'timeoutMs': 60000,
                           'modelSettings': {'protocol': 'anthropic-messages', 'maxOutputTokens': 16384, 'reasoning': 'medium'}}
                if workflow != 'deal':
                    request['workflow'] = workflow
                    request['initialEvidence'] = 'ULYSSE_WORKFLOW_EVIDENCE_V1\n' + json.dumps({'context': {'kind': workflow}, 'sources': [{'text': 'fixture ' * 1500}], 'untrusted': True})
                try:
                    result = isolated_run(request)
                except RuntimeError as error:
                    self.fail(f"Native fixture failure: {NativeEndpoint.failures}; paths: {[c[0] for c in NativeEndpoint.calls]}; {error}")
                self.assertEqual(result['outcome'], 'abstained')
                native_calls = [c for c in NativeEndpoint.calls if c[1] == token]
                self.assertEqual(len(native_calls), 2)
                self.assertTrue(all(c[0] == '/agent/v1/messages' and c[2] is None for c in native_calls))
                self.assertEqual(sum(c[2] == 'Bearer ' + token for c in NativeEndpoint.calls), 2)
                expected = Path(__file__).with_name('instructions.txt' if workflow == 'deal' else 'workflows.txt').read_text()
                self.assertTrue(all(b['system'] == expected for b in NativeEndpoint.bodies[-2:]))
                self.assertTrue(all(b['output_config']['effort'] == 'medium' for b in NativeEndpoint.bodies[-2:]))
                if workflow != 'deal':
                    first = NativeEndpoint.bodies[-2]['messages'][0]['content']
                    self.assertEqual(first if isinstance(first, str) else first[0]['text'], request['initialEvidence'])
            self.assertEqual(NativeEndpoint.failures, [])
        finally:
            server.shutdown()
            server.server_close()
            os.environ.pop('ULYSSE_GATEWAY_URL', None)

    def setUp(self):
        Endpoint.calls = []
        Endpoint.systems = []
        Endpoint.replayed_reasoning = []
        Endpoint.models = []

    def test_native_fallback_keeps_tool_results_and_uses_only_the_scoped_gateway(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Endpoint)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        os.environ["ULYSSE_GATEWAY_URL"] = f"http://127.0.0.1:{server.server_port}/agent"
        try:
            request = {'runId': str(uuid4()), 'subjectId': str(uuid4()), 'capability': 'f' * 43,
                       'mode': 'hermes-stub', 'workflow': 'buyer', 'model': 'z-ai/glm-5.3-flash',
                       'fallbackModel': 'mistralai/mistral-small-2603', 'timeoutMs': 90000}
            result = isolated_run(request)
            self.assertEqual(result['outcome'], 'abstained')
            self.assertIn(request['fallbackModel'], Endpoint.models)
            self.assertEqual(sum(path == '/agent/tools/get_workflow_context' for path, _ in Endpoint.calls), 1)
            self.assertTrue(all(token == 'Bearer ' + request['capability'] for _, token in Endpoint.calls))
        finally:
            server.shutdown()
            server.server_close()
            os.environ.pop('ULYSSE_GATEWAY_URL', None)

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
