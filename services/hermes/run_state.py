"""Settings of the single execution hosted by this process.

server.py starts one runner process per execution, so this module never holds two
tenants' settings at once. runner.py fills it before Hermes loads the Ulysse plugin.
"""

GATEWAY_URL = ""
CAPABILITY = ""
INSTRUCTIONS = ""
