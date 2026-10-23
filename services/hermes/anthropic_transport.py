"""Native Hermes Messages transport behind Ulysse's authenticated private relay.

The pinned upstream treats every non-Anthropic hostname as a different vendor
and strips Claude signatures. Its public transport registry is the extension
point: retain the native serializer/replay policy, while the SDK still connects
only to the private worker. No provider key, new loop, retry or upstream patch.
"""
from agent.transports import get_transport, register_transport
from agent.transports.anthropic import AnthropicTransport


class UlysseAnthropicTransport(AnthropicTransport):
    def build_kwargs(self, model, messages, tools=None, **params):
        params["base_url"] = None  # Serialization policy only; never the SDK destination.
        return super().build_kwargs(model, messages, tools, **params)

    def convert_messages(self, messages, **kwargs):
        kwargs["base_url"] = None
        return super().convert_messages(messages, **kwargs)


def register():
    get_transport("anthropic_messages")  # Finish upstream registry discovery first.
    register_transport("anthropic_messages", UlysseAnthropicTransport)
