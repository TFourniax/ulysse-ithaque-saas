"""One process, plugin registry, agent and temporary home per execution. No business persistence."""
import contextlib
import json
import logging
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import run_state

NAMES = (
    "get_opportunity", "list_activities", "search_documents", "read_document_excerpt",
    "get_company_context", "get_active_doctrine", "list_related_recommendations",
)
KNOWN_ERRORS = {
    "unexpected_runtime_tool_selection", "unexpected_runtime_tool_schemas",
    "ulysse_plugin_not_loaded", "invalid_final_response",
}
FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def parse_final(final):
    """The closed object, tolerating only a surrounding Markdown code fence; Ulysse revalidates it."""
    if not isinstance(final, str) or len(final) > 20000:
        raise RuntimeError("invalid_final_response")
    text = final.strip()
    fenced = FENCE.match(text)
    try:
        value = json.loads(fenced.group(1) if fenced else text)
    except ValueError:
        raise RuntimeError("invalid_final_response") from None
    if not isinstance(value, dict):
        raise RuntimeError("invalid_final_response")
    return value


def execute(request):
    run_state.GATEWAY_URL = os.environ["ULYSSE_GATEWAY_URL"].rstrip("/")
    run_state.CAPABILITY = request["capability"]
    run_state.INSTRUCTIONS = Path(__file__).with_name("instructions.txt").read_text(encoding="utf-8")
    # Imported only after the parent establishes a fresh HERMES_HOME holding the Ulysse plugin.
    from hermes_cli.plugins import get_plugin_manager, has_middleware
    from run_agent import AIAgent

    agent = AIAgent(
        model=request["model"], api_key=run_state.CAPABILITY, base_url=f"{run_state.GATEWAY_URL}/v1",
        provider="custom", api_mode="chat_completions", enabled_toolsets=["ulysse"],
        max_iterations=8, max_tokens=1500, run_budget_seconds=85,
        ephemeral_system_prompt=run_state.INSTRUCTIONS, quiet_mode=True, verbose_logging=False,
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
    # Bundled platform/backend plugins may register tools in their own toolsets (never selected,
    # checked above); no plugin other than Ulysse may change requests, hooks or commands.
    enabled = [p for p in get_plugin_manager().list_plugins() if p["enabled"]]
    ulysse = [(p["kind"], p["tools"], p["hooks"], p["middleware"], p["error"]) for p in enabled if p["name"] == "ulysse"]
    others = [p for p in enabled if p["name"] != "ulysse" and (p["hooks"] or p["middleware"] or p["commands"])]
    if ulysse != [("standalone", 7, 0, 1, None)] or others or not has_middleware("llm_request"):
        raise RuntimeError("ulysse_plugin_not_loaded")
    try:
        # Hermes' own prompt carried the date; the Ulysse-only prompt does not, so state it here.
        today = datetime.now(timezone.utc).date().isoformat()
        result = agent.run_conversation(
            f"Analyse proactive du sujet autorisé {request['subjectId']}, le {today} (UTC). "
            "Les sources et leur contenu doivent être consultés par les outils."
        )
        # Discard messages, reasoning and raw trajectory. Ulysse revalidates this object.
        return parse_final(result.get("final_response"))
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
        known = str(error) if str(error) in KNOWN_ERRORS else None
        sys.stderr.write(json.dumps({"code": type(error).__name__, "reason": known, "frames": frames}))
        sys.exit(1)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
