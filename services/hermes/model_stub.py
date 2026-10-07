"""SIMULATED OpenAI-compatible model endpoint for the hermes-stub mode (local stack and CI).

It holds no credential and never calls a provider. It answers like a scripted model so that
the real Hermes loop, the worker gateway, the Ulysse tools, PostgreSQL and publication run end
to end. Ulysse labels every result of this mode as simulated: it is never live evidence and
says nothing about the relevance of a real model.
"""
import json
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FIRST = ("get_opportunity", "get_company_context", "get_active_doctrine", "list_related_recommendations")
SECOND = ("list_activities", "search_documents")
TOOLS = set(FIRST + SECOND + ("read_document_excerpt",))


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


def respond(body):
    messages = body.get("messages") or []
    names = {t.get("function", {}).get("name") for t in body.get("tools") or []}
    if names and names != TOOLS:
        raise ValueError("unexpected tools")
    calls = _calls_and_results(messages)
    called = {c["name"] for c in calls}
    turn = sum(1 for m in messages if m.get("role") == "assistant")
    subject = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                        next((m.get("content") or "" for m in messages if m.get("role") == "user"), ""))
    pending = []
    if not set(FIRST) <= called:
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
        finish = "tool_calls"
    else:
        message = {"role": "assistant", "content": json.dumps(_final(calls), ensure_ascii=False)}
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
            self._send(200, respond(json.loads(self.rfile.read(size))))
        except Exception:
            self._send(400, {"error": {"message": "invalid simulated request", "type": "invalid_request_error"}})

    def _send(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
