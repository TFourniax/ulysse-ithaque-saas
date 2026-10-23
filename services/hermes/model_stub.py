"""SIMULATED OpenAI-compatible model endpoint for the hermes-stub mode (local stack and CI).

It holds no credential and never calls a provider. It answers like a scripted model so that
the real Hermes loop, the worker gateway, the Ulysse tools, PostgreSQL and publication run end
to end. Ulysse labels every result of this mode as simulated: it is never live evidence and
says nothing about the relevance of a real model.
"""
import json
import hashlib
import re
import sys
import threading
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FIRST = ("get_opportunity", "get_company_context", "get_active_doctrine", "list_related_recommendations")
SECOND = ("list_activities", "search_documents")
TOOLS = set(FIRST + SECOND + ("read_document_excerpt",))
REASONING_FIXTURE = [{"type": "reasoning.encrypted", "data": "simulated-opaque-signature", "format": "unknown", "index": 0}]


def _calls_and_results(messages):
    """Tool names called so far, their arguments and parsed results, from the transcript only."""
    calls = {}
    for m in messages:
        for call in m.get("tool_calls") or []:
            fn = call.get("function", {})
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except ValueError:
                args = {}
            calls[call.get("id")] = {"name": fn.get("name"), "args": args, "result": None}
    for m in messages:
        if m.get("role") == "tool" and m.get("tool_call_id") in calls:
            try:
                calls[m["tool_call_id"]]["result"] = json.loads(m.get("content") or "null")
            except ValueError:
                calls[m["tool_call_id"]]["result"] = None
    return list(calls.values())


def _tool_calls(turn, names_and_args):
    return [
        {"id": f"stub_{turn}_{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
        for i, (name, args) in enumerate(names_and_args)
    ]


def _references(value, found):
    if isinstance(value, dict):
        ref = value.get("reference")
        if isinstance(ref, str) and ref not in found:
            found.append(ref)
        for v in value.values():
            _references(v, found)
    elif isinstance(value, list):
        for v in value:
            _references(v, found)
    return found


def _final(calls):
    by_name = {}
    for c in calls:
        by_name.setdefault(c["name"], []).append(c["result"] or {})
    opportunity = (by_name.get("get_opportunity") or [{}])[0]
    policy = opportunity.get("contactPolicy") or {}
    pause = policy.get("pauseUntil")
    now = datetime.now(timezone.utc).isoformat()
    base = {"version": "ulysse-agent-v1", "proposals": []}
    if policy.get("opposed") or (isinstance(pause, str) and pause > now):
        return {**base, "outcome": "no_signal",
                "summary": "Modèle simulé : opposition ou pause explicite, aucune sollicitation proposée."}
    activities = (by_name.get("list_activities") or [{}])[0]
    excerpts = [item for r in by_name.get("read_document_excerpt", []) for item in r.get("items") or []]
    items = list(activities.get("items") or []) + excerpts
    if activities.get("state") != "present" and not excerpts:
        return {**base, "outcome": "abstained",
                "summary": "Modèle simulé : aucun échange ni document disponible ; informations insuffisantes."}
    latest = max(items, key=lambda m: str(m.get("occurredAt", "")))
    refs = [r for r in _references([c["result"] for c in calls], []) if not r.startswith("recommendation:")][:12]
    return {**base, "outcome": "proposals",
            "summary": "Modèle simulé : proposition construite à partir des sources réellement lues.",
            "proposals": [{
                "action": "clarify",
                "title": f"Préparer une réponse à « {latest.get('title', 'dernier échange')} »",
                "nextStep": f"Préparer, pour validation humaine, une réponse fondée sur « {latest.get('title')} » "
                            f"du {str(latest.get('occurredAt', ''))[:10]}.",
                "justification": "Texte produit par le modèle simulé de recette à partir des lectures effectuées ; "
                                 "il ne mesure pas la pertinence d'un modèle réel.",
                "references": refs,
                "assumptions": [],
                "missingInformation": ["Évaluation par un modèle réel et revue humaine"],
                "limits": ["Modèle simulé", "Sources et doctrine fictives", "Aucun envoi externe"],
                "urgency": "normal",
            }]}


WORKFLOW_TOOLS = {"get_workflow_context", "list_company_sources", "read_company_source"}
RETRY_FIXTURES = deque(maxlen=256)
RETRY_LOCK = threading.Lock()


def workflow_fixture_key(body):
    prefix = "ULYSSE_WORKFLOW_EVIDENCE_V1\n"
    for message in body.get("messages", []):
        text = message.get("content")
        if message.get("role") == "user" and isinstance(text, str) and text.startswith(prefix):
            evidence = json.loads(text[len(prefix):])
            return next((ref for ref in evidence.get("context", {}).get("references", [])
                         if isinstance(ref, str) and re.fullmatch(r"workflow:[0-9a-f-]{36}", ref)), None)
    return None


def transient_workflow_fixture(body):
    """One refusal after tools, only in the simulated endpoint; no external traffic."""
    if not body.get("response_format") or not any(m.get("role") == "tool" for m in body.get("messages", [])):
        return False
    key = workflow_fixture_key(body)
    with RETRY_LOCK:
        forced = any(isinstance(m.get('content'), str) and 'CI_NATIVE_FALLBACK' in m['content']
                     for m in body.get('messages', []))
        if key and forced and body.get('model') == 'openai/gpt-4.1-mini':
            if key not in RETRY_FIXTURES:
                RETRY_FIXTURES.append(key)
            return True
        if not key or key in RETRY_FIXTURES:
            return False
        RETRY_FIXTURES.append(key)
        return True


def _workflow_step(calls, evidence=None):
    evidence = evidence or {}
    called = {c["name"] for c in calls}
    if evidence.get("context"):
        called.add("get_workflow_context")
    first = [n for n in ("get_workflow_context", "list_company_sources") if n not in called]
    if first:
        return [(n, {}) for n in first], None
    sources = [i for c in calls if c["name"] == "list_company_sources" for i in (c["result"] or {}).get("items", [])]
    read = {s["id"] for s in evidence.get("sources", [])}
    for call in calls:
        if call["name"] == "read_company_source":
            read.update(call["args"].get("sourceIds", [call["args"].get("sourceId")]))
    missing = [s["id"] for s in sources if s["id"] not in read]
    pending = [("read_company_source", {"sourceIds": missing[i:i + 4]}) for i in range(0, len(missing), 4)]
    if pending:
        return pending, None
    context = evidence.get("context") or next((c["result"] or {} for c in calls if c["name"] == "get_workflow_context"), {})
    result = {"version": "november-v1", "kind": context.get("kind", "buyer"), "outcome": "abstained",
        "summary": "Modèle simulé : corpus lu, diagnostic métier et rédaction réservés à la recette avec le modèle réel.",
        "questions": [], "findings": [], "benchmark": [], "buyerQuestions": [], "uniqueness": None,
        "content": None, "limits": ["Simulation technique, aucune preuve de pertinence métier."] +
        (["Sources obligatoires fournies automatiquement."] if evidence else [])}
    own = next((s for s in evidence.get("sources", []) if s.get("kind") in ("offer", "website") and s.get("reference")), None)
    if result["kind"] == "buyer" and own:
        # Exercise the worker's independent review after the actual Hermes loop.
        result.update(outcome="draft", findings=[{"topic": "Fixture", "analysis": "Offre fictive à relire.", "references": [own["reference"]]}],
                      uniqueness={"verdict": "insufficient_evidence", "reason": "Aucune qualité métier démontrée par un stub.", "references": [own["reference"]]})
        result['benchmark'] = [{'topic': rival['title'], 'analysis': 'Comparaison fictive : les deux offres décrivent un accompagnement. Prix non documentés dans ces textes.',
                                'references': [own['reference'], rival['reference']]}
                               for rival in evidence.get('sources', []) if rival.get('kind') == 'competitor'][:8]
    elif result['kind'] == 'content' and own:
        result.update(outcome='draft', content={'title': 'Contenu fictif issu du diagnostic',
            'body': 'Scénario simulé : présenter le diagnostic de flux et demander le périmètre attendu.',
            'callToAction': 'Préciser le périmètre fictif.', 'rationale': 'Reprise du diagnostic acheteur fourni par le contexte.',
            'references': [own['reference'], *[ref for ref in context.get('references', []) if ref.startswith('buyer:')]][:12]})
    return [], result


def respond(body):
    messages = body.get("messages") or []
    thinking = body.get("model") == "z-ai/glm-5.3-flash"
    if thinking and any(m.get("role") == "assistant" and m.get("tool_calls") and
                        m.get("reasoning_details") != REASONING_FIXTURE for m in messages):
        raise ValueError("missing simulated reasoning replay")
    names = {t.get("function", {}).get("name") for t in body.get("tools") or []}
    if names and names not in (TOOLS, WORKFLOW_TOOLS):
        raise ValueError("unexpected tools")
    calls = _calls_and_results(messages)
    called = {c["name"] for c in calls}
    turn = sum(1 for m in messages if m.get("role") == "assistant")
    subject = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                        next((m.get("content") or "" for m in messages if m.get("role") == "user"), ""))
    pending = []
    workflow_result = None
    review_prefix = "ULYSSE_BUYER_DRAFT_TO_REVIEW_V1\n"
    review = next((json.loads(m["content"][len(review_prefix):]) for m in messages
                   if m.get("role") == "user" and isinstance(m.get("content"), str)
                   and m["content"].startswith(review_prefix)), None)
    if review:
        if names or calls:
            raise ValueError("review must be a separate tool-free pass")
        prefix = "ULYSSE_WORKFLOW_EVIDENCE_V1\n"
        evidence = next((json.loads(m["content"][len(prefix):]) for m in messages
                         if isinstance(m.get("content"), str) and m["content"].startswith(prefix)), {})
        if not any(s.get("text") and s.get("reference") for s in evidence.get("sources", [])):
            raise ValueError("review has no source text")
        workflow_result = {**review["draft"],
                           "summary": "Modèle simulé : brouillon comparatif relu techniquement, aucune validation de pertinence métier.",
                           "limits": list(dict.fromkeys([*review["draft"]["limits"], "Relecture séparée exécutée avec les preuves consultées."]))}
        # Force a real review repair in complete-stack acceptance, then return the
        # bilateral references. This is deliberately a fault fixture, never live logic.
        repairing = any(m.get('role') == 'user' and isinstance(m.get('content'), str)
                        and m['content'].startswith('Ulysse a refusé les références du diagnostic') for m in messages)
        if len(workflow_result['benchmark']) >= 2:
            if repairing:
                own = next(s['reference'] for s in evidence['sources'] if s.get('kind') in ('offer', 'website'))
                rivals = {s['reference'] for s in evidence['sources'] if s.get('kind') == 'competitor'}
                workflow_result['benchmark'] = [{**row, 'references': [own, *[r for r in row['references'] if r in rivals]]}
                                                for row in workflow_result['benchmark']]
            else:
                workflow_result['benchmark'] = [{**row, 'references': row['references'][1:]} for row in workflow_result['benchmark']]
    elif names == WORKFLOW_TOOLS or "get_workflow_context" in called:
        prefix = "ULYSSE_WORKFLOW_EVIDENCE_V1\n"
        evidence = next((json.loads(m["content"][len(prefix):]) for m in messages
                         if m.get("role") == "user" and isinstance(m.get("content"), str)
                         and m["content"].startswith(prefix)), None)
        pending, workflow_result = _workflow_step(calls, evidence)
        response_format = body.get("response_format")
        if response_format:
            contract = response_format.get("json_schema", {})
            schema = contract.get("schema", {})
            if response_format.get("type") != "json_schema" or contract.get("strict") is not True or schema.get("additionalProperties") is not False:
                raise ValueError("invalid simulated native result schema")
            if workflow_result is not None:
                if schema.get("properties", {}).get("kind", {}).get("const") != workflow_result["kind"]:
                    raise ValueError("wrong simulated native workflow kind")
                workflow_result["limits"].append("Schéma natif reçu par le fournisseur simulé.")
                with RETRY_LOCK:
                    if workflow_fixture_key(body) in RETRY_FIXTURES:
                        workflow_result["limits"].append("Reprise après HTTP 429 du fournisseur simulé.")
                if body.get('model') == 'mistralai/mistral-small-2603':
                    workflow_result['limits'].append('Modèle de secours simulé utilisé.')
    elif not set(FIRST) <= called:
        pending = [(n, {"subjectId": subject.group(0)} if n == "get_opportunity" and subject else {})
                   for n in FIRST if n not in called]
    elif not set(SECOND) <= called:
        pending = [(n, {}) for n in SECOND if n not in called]
    else:
        searched = [c["result"] or {} for c in calls if c["name"] == "search_documents"]
        read = {c["args"].get("documentId") for c in calls if c["name"] == "read_document_excerpt"}
        documents = [item.get("id") for r in searched for item in r.get("items") or []]
        pending = [("read_document_excerpt", {"documentId": d}) for d in documents if d not in read][:2]
    if pending:
        message = {"role": "assistant", "content": None, "tool_calls": _tool_calls(turn, pending)}
        if thinking:
            message["reasoning_details"] = REASONING_FIXTURE
        finish = "tool_calls"
    else:
        message = {"role": "assistant", "content": json.dumps(workflow_result if workflow_result is not None else _final(calls), ensure_ascii=False)}
        finish = "stop"
    size = len(json.dumps(body))
    return {
        "id": f"stub-{turn}", "object": "chat.completion", "created": int(datetime.now().timestamp()),
        "model": body.get("model"), "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        # Nothing is charged by a simulated endpoint: the declared cost is zero.
        "usage": {"prompt_tokens": size // 4, "completion_tokens": len(json.dumps(message)) // 4, "cost": 0},
    }


def native_prefix(body, length=None):
    """Fixture signature binds system, tools and preceding messages, excluding cache hints."""
    def clean(value):
        if isinstance(value, list): return [clean(v) for v in value]
        if isinstance(value, dict): return {k: clean(v) for k, v in value.items() if k != 'cache_control'}
        return value
    prefix = {k: body.get(k) for k in ('system', 'tools')}
    # Messages accepts a string as shorthand for one text block. Hermes switches
    # between these equivalent representations when moving cache breakpoints.
    prefix['messages'] = [
        {**message, 'content': [{'type': 'text', 'text': message['content']}]}
        if isinstance(message.get('content'), str) else message
        for message in body.get('messages', [])[:length]
    ]
    return hashlib.sha256(json.dumps(clean(prefix), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def native_to_fixture(body):
    """Test-only bridge into shared scripted business fixtures, never a live adapter."""
    if body.get('stream') or 'provider' in body or 'response_format' in body:
        raise ValueError('unexpected native request')
    messages = [{'role': 'system', 'content': body.get('system', '')}]
    for index, message in enumerate(body.get('messages', [])):
        content = message.get('content')
        if isinstance(content, str):
            messages.append(message)
            continue
        if message['role'] == 'assistant':
            uses = [b for b in content if b.get('type') == 'tool_use']
            if uses:
                expected = []
                for use in uses:
                    expected.extend([{'type': 'thinking', 'thinking': '', 'signature': native_prefix(body, index) + ':' + use['id']},
                                     {k: use[k] for k in ('type', 'id', 'name', 'input')}])
                actual = [{k: v for k, v in b.items() if k != 'cache_control'} for b in content]
                if actual != expected:
                    raise ValueError('native signed block order lost')
            messages.append({'role': 'assistant', 'content': ''.join(b['text'] for b in content if b['type'] == 'text'),
                             'tool_calls': [{'id': b['id'], 'type': 'function', 'function': {'name': b['name'], 'arguments': json.dumps(b['input'])}} for b in uses]})
        else:
            for block in content:
                if block['type'] == 'tool_result':
                    value = block['content']
                    if isinstance(value, list): value = ''.join(b['text'] for b in value)
                    messages.append({'role': 'tool', 'tool_call_id': block['tool_use_id'], 'content': value})
                elif block['type'] == 'text':
                    messages.append({'role': 'user', 'content': block['text']})
    schema = body.get('output_config', {}).get('format', {}).get('schema')
    return {'model': body.get('model'), 'messages': messages,
            'tools': [{'type': 'function', 'function': {'name': t['name'], 'parameters': t['input_schema']}} for t in body.get('tools', [])],
            **({'response_format': {'type': 'json_schema', 'json_schema': {'strict': True, 'schema': schema}}} if schema else {})}


def native_response(response, request):
    message = response['choices'][0]['message']
    blocks = []
    for call in message.get('tool_calls', []):
        blocks.extend([{'type': 'thinking', 'thinking': '', 'signature': native_prefix(request) + ':' + call['id']},
                       {'type': 'tool_use', 'id': call['id'], 'name': call['function']['name'], 'input': json.loads(call['function']['arguments'])}])
    if message.get('content'):
        blocks.append({'type': 'text', 'text': message['content']})
    return {'id': 'msg_fixture', 'type': 'message', 'role': 'assistant', 'model': response.get('model'), 'content': blocks,
            'stop_reason': 'tool_use' if message.get('tool_calls') else 'end_turn', 'stop_sequence': None,
            'usage': {'input_tokens': 0, 'output_tokens': 0, 'cache_creation_input_tokens': 0, 'cache_read_input_tokens': 0}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self._send(200 if self.path == "/health" else 404, {"status": "ok"})

    def do_POST(self):
        if self.path not in ("/v1/chat/completions", "/v1/messages"):
            self._send(404, {"error": "not_found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 100000:
                raise ValueError("request_size")
            body = json.loads(self.rfile.read(size))
            original = body
            native = self.path == '/v1/messages'
            if native:
                if self.headers.get('x-api-key') != 'none':
                    raise ValueError('a provider credential reached the stub')
                body = native_to_fixture(body)
            if transient_workflow_fixture(body):
                self._send(429, {"error": {"code": 429, "message": "simulated temporary rate limit"}}, retry_after="1")
            else:
                response = respond(body)
                self._send(200, native_response(response, original) if native else response)
        except Exception:
            self._send(400, {"error": {"message": "invalid simulated request", "type": "invalid_request_error"}})

    def _send(self, status, body, retry_after=None):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if retry_after is not None:
            self.send_header("Retry-After", retry_after)
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
