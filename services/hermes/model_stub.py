"""SIMULATED OpenAI-compatible model endpoint for the hermes-stub mode (local stack and CI).

It holds no credential and never calls a provider. It answers like a scripted model so that
the real Hermes loop, the worker gateway, the Ulysse tools, PostgreSQL and publication run end
to end. Ulysse labels every result of this mode as simulated: it is never live evidence and
says nothing about the relevance of a real model.
"""
import json
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
        if names or calls or any(m.get("role") == "assistant" for m in messages):
            raise ValueError("review must be a separate tool-free pass")
        prefix = "ULYSSE_WORKFLOW_EVIDENCE_V1\n"
        evidence = next((json.loads(m["content"][len(prefix):]) for m in messages
                         if isinstance(m.get("content"), str) and m["content"].startswith(prefix)), {})
        if not any(s.get("text") and s.get("reference") for s in evidence.get("sources", [])):
            raise ValueError("review has no source text")
        workflow_result = {**review["draft"], "outcome": "abstained", "findings": [], "benchmark": [], "buyerQuestions": [], "uniqueness": None,
                           "summary": "Modèle simulé : relecture technique exécutée, aucune validation de pertinence métier.",
                           "limits": [*review["draft"]["limits"], "Relecture séparée exécutée avec les preuves consultées."]}
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


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self._send(200 if self.path == "/health" else 404, {"status": "ok"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self._send(404, {"error": "not_found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 100000:
                raise ValueError("request_size")
            body = json.loads(self.rfile.read(size))
            if transient_workflow_fixture(body):
                self._send(429, {"error": {"code": 429, "message": "simulated temporary rate limit"}}, retry_after="1")
            else:
                self._send(200, respond(body))
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
