"""Ulysse plugin for Hermes: seven read-only tools and the Ulysse-only system prompt.

Loaded through the official plugin API (``plugins.enabled``) from the per-execution
HERMES_HOME. Tools reach Ulysse only through the worker gateway with the execution
capability; the worker re-establishes tenant, scope and versions for every call.
"""
import json
import urllib.request

import run_state

TOOLSET = "ulysse"
DESCRIPTIONS = {
    "get_opportunity": "Lire le CRM et les contraintes de contact du sujet autorisé.",
    "list_activities": "Lire au plus six échanges, notes et activités fictifs du sujet.",
    "search_documents": "Chercher les métadonnées des documents autorisés du sujet.",
    "read_document_excerpt": "Lire un extrait de document avec référence et version.",
    "get_company_context": "Lire les offres, objectifs et contraintes de l'entreprise fixée par le serveur.",
    "get_active_doctrine": "Lire la doctrine fictive active et ses contraintes impératives.",
    "list_related_recommendations": "Lire les propositions et décisions humaines précédentes du sujet.",
}
NAMES = tuple(DESCRIPTIONS)


def _parameters(name):
    properties = {}
    required = []
    if name == "get_opportunity":
        properties["subjectId"] = {"type": "string", "description": "Identifiant fourni par Ulysse"}
        required.append("subjectId")
    if name == "search_documents":
        properties["query"] = {"type": "string", "maxLength": 100}
    if name == "read_document_excerpt":
        properties["documentId"] = {"type": "string", "maxLength": 100}
        required.append("documentId")
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}


def _handler(name):
    def call(args, **_kwargs):
        request = urllib.request.Request(
            f"{run_state.GATEWAY_URL}/tools/{name}", data=json.dumps(args).encode(), method="POST",
            headers={"Authorization": f"Bearer {run_state.CAPABILITY}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.read(40000).decode()
        except Exception:
            # Refusals carry no detail: scope, expiry, limits and versions are decided by Ulysse.
            return json.dumps({"state": "unavailable", "error": "execution_scope_or_limit"})
    return call


def _ulysse_system_prompt(**kwargs):
    """Replace Hermes' generic agent prompt with the versioned Ulysse instructions only.

    Hermes middleware is fail-open, so the worker gateway independently refuses any
    request whose system prompt differs from these instructions.
    """
    request = dict(kwargs["request"])
    messages = request.get("messages")
    if not isinstance(messages, list):
        return None
    kept = [m for m in messages if not (isinstance(m, dict) and m.get("role") in ("system", "developer"))]
    request["messages"] = [{"role": "system", "content": run_state.INSTRUCTIONS}, *kept]
    return {"request": request, "source": "ulysse", "reason": "ulysse_instructions_only"}


def register(ctx):
    for name in NAMES:
        schema = {"name": name, "description": DESCRIPTIONS[name], "parameters": _parameters(name)}
        ctx.register_tool(name=name, toolset=TOOLSET, schema=schema, handler=_handler(name))
    ctx.register_middleware("llm_request", _ulysse_system_prompt)
