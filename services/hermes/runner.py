"""One process, registry, agent and temporary home per execution. No business persistence."""
import contextlib
import json
import logging
import os
import sys
import traceback
import urllib.request
from pathlib import Path

NAMES = (
    "get_opportunity", "list_activities", "search_documents", "read_document_excerpt",
    "get_company_context", "get_active_doctrine", "list_related_recommendations",
)


def execute(request):
    gateway = os.environ["ULYSSE_GATEWAY_URL"].rstrip("/")
    capability = request["capability"]
    # Imported only after the parent establishes a fresh, empty HERMES_HOME.
    from tools.registry import registry
    from run_agent import AIAgent

    def handler(name):
        def call(args, **_kwargs):
            payload = json.dumps(args).encode()
            req = urllib.request.Request(
                f"{gateway}/tools/{name}", data=payload, method="POST",
                headers={"Authorization": f"Bearer {capability}", "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    return response.read(40000).decode()
            except Exception:
                return json.dumps({"state": "unavailable", "error": "execution_scope_or_limit"})
        return call

    descriptions = {
        "get_opportunity": "Lire le CRM et les contraintes de contact du sujet autorisé.",
        "list_activities": "Lire au plus six échanges, notes et activités fictifs du sujet.",
        "search_documents": "Chercher les métadonnées des documents autorisés du sujet.",
        "read_document_excerpt": "Lire un extrait de document avec référence et version.",
        "get_company_context": "Lire les offres, objectifs et contraintes de l'entreprise fixée par le serveur.",
        "get_active_doctrine": "Lire la doctrine fictive active et ses contraintes impératives.",
        "list_related_recommendations": "Lire les propositions et décisions humaines précédentes du sujet.",
    }
    for name in NAMES:
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
        schema = {"name": name, "description": descriptions[name], "parameters": {
            "type": "object", "properties": properties, "required": required, "additionalProperties": False,
        }}
        registry.register(name=name, toolset="ulysse", schema=schema, handler=handler(name))

    instructions = Path(__file__).with_name("instructions.txt").read_text(encoding="utf-8")
    agent = AIAgent(
        model=request["model"], api_key=capability, base_url=f"{gateway}/v1",
        provider="custom", api_mode="chat_completions", enabled_toolsets=["ulysse"],
        max_iterations=8, max_tokens=1500, run_budget_seconds=85,
        ephemeral_system_prompt=instructions, quiet_mode=True, verbose_logging=False,
        save_trajectories=False, skip_context_files=True, load_soul_identity=False,
        skip_memory=True, skip_background_review=True, session_db=None,
        checkpoints_enabled=False, fallback_model=None, credential_pool=None,
        cwd=os.environ["HERMES_HOME"], reasoning_config={"enabled": False},
    )
    # A prompt cannot impose the allowlist: fail closed on the actual runtime selection.
    if set(agent.valid_tool_names) != set(NAMES):
        raise RuntimeError("unexpected_runtime_tool_selection")
    if {tool["function"]["name"] for tool in agent.tools} != set(NAMES):
        raise RuntimeError("unexpected_runtime_tool_schemas")
    try:
        result = agent.run_conversation(
            f"Analyse proactive du sujet autorisé {request['subjectId']}. "
            "Les sources et leur contenu doivent être consultés par les outils."
        )
        final = result.get("final_response")
        if not isinstance(final, str) or len(final) > 20000:
            raise RuntimeError("invalid_final_response")
        # Discard messages, reasoning and raw trajectory. Ulysse revalidates this object.
        return json.loads(final)
    finally:
        agent.close()


if __name__ == "__main__":
    request = json.loads(sys.stdin.read(8192))
    logging.disable(logging.CRITICAL)
    try:
        with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            result = execute(request)
    except Exception as error:
        frames = [{"file": Path(f.filename).name, "line": f.lineno} for f in traceback.extract_tb(error.__traceback__)]
        known = str(error) if str(error) in {"unexpected_runtime_tool_selection", "unexpected_runtime_tool_schemas", "invalid_final_response"} else None
        sys.stderr.write(json.dumps({"code": type(error).__name__, "reason": known, "frames": frames}))
        sys.exit(1)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
