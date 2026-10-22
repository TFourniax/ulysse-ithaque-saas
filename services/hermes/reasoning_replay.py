"""OpenRouter reasoning continuity through Hermes' generic custom-provider transport.

Official llm_execution middleware; no upstream patch, network call or persistence.
Each instance belongs to one isolated runner process. The worker still checks the
whole restored request against its context, cost, model and tool boundaries.
"""
from copy import deepcopy
import json


def _plain(value):
    return value.model_dump(exclude_none=True) if hasattr(value, "model_dump") else value


def _calls(message):
    calls = message.get("tool_calls")
    if not isinstance(calls, list) or not calls:
        return None
    pairs = [(call.get("id"), call.get("function", {}).get("name")) for call in calls]
    return tuple(pairs) if all(isinstance(v, str) and v for pair in pairs for v in pair) else None


class ReasoningReplay:
    def __init__(self):
        self.entries = {}
        self.failed = False
        self.model = None
        self.foreign_calls = set()

    def __call__(self, *, request, next_call, **_context):
        try:
            outgoing = deepcopy(request)
            model = request.get("model")
            if self.model is not None and model != self.model:
                self.foreign_calls.update(self.entries)
                self.entries.clear()
            self.model = model
            for message in outgoing.get("messages", []):
                if message.get("role") == "assistant":
                    if _calls(message) in self.foreign_calls:
                        for name in ("reasoning", "reasoning_content", "reasoning_details"):
                            message.pop(name, None)
                    fields = self.entries.get(_calls(message))
                    if fields:
                        message.update(deepcopy(fields))
        except Exception:
            self.failed = True
            raise RuntimeError("reasoning_replay_failed") from None
        # Do not catch provider errors or retry: Hermes owns conversation recovery;
        # Ulysse authorizes and accounts for every attempted transmission.
        response = next_call(outgoing)
        try:
            plain = _plain(response)
            choices = plain.get("choices", []) if isinstance(plain, dict) else []
            message = _plain(choices[0].get("message", {})) if choices else {}
            key = _calls(message)
            fields = {name: deepcopy(message[name]) for name in ("reasoning", "reasoning_details") if message.get(name)}
            if "reasoning" not in fields and isinstance(message.get("reasoning_content"), str):
                fields["reasoning"] = message["reasoning_content"]
            if key and fields:
                if len(json.dumps(fields).encode()) > 80000 or (key not in self.entries and len(self.entries) >= 8):
                    raise ValueError("reasoning_replay_limit")
                self.entries[key] = fields
        except Exception:
            # Hermes middleware is fail-open; the runner checks this before accepting a result.
            self.failed = True
        return response
