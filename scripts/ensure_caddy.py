#!/usr/bin/env python3
"""Ensure Anton's Caddy routes are present. Safe to re-run."""
import os, sys

f = '/etc/caddy/Caddyfile'
if not os.path.exists(f):
    print('    No Caddyfile found, skipping')
    sys.exit(0)

content = open(f).read()
# Canary strings that only exist in the new layout. The old layout had a
# wildcard `handle_path /_anton/*` that dumped everything to the sidecar and
# broke /_anton/webhooks/* (slack-bot) and /_anton/proxy/notify; rewriting is
# the safe move whenever we can't see the new-shape markers.
checks = ['_anton/health', '_anton/status', '/a/*', '/p/*']
wildcard_sidecar = 'handle_path /_anton/*'
if all(c in content for c in checks) and wildcard_sidecar not in content:
    print('    Caddy routes already configured')
    sys.exit(0)

domain = content.split()[0]
new = f"""{domain} {{
    handle /a/* {{
        uri strip_prefix /a
        root * /home/anton/.anton/published
        file_server
    }}
    handle /p/* {{
        uri strip_prefix /p
        root * /home/anton/Anton
        file_server
    }}

    # Sidecar — expose /health and /status only. /update/* is Bearer-token
    # protected and must stay off the public internet.
    handle_path /_anton/health {{
        reverse_proxy localhost:9878
    }}
    handle_path /_anton/status {{
        reverse_proxy localhost:9878
    }}

    # Everything else goes to the agent: /_anton/oauth/*, /_anton/telegram/*,
    # /_anton/webhooks/* (slack-bot, etc.), /_anton/proxy/notify, and the
    # WebSocket upgrade at /. One catch-all instead of enumerating subpaths
    # so new webhook providers don't need a Caddyfile edit per-install.
    reverse_proxy localhost:9876
}}
"""
open(f, 'w').write(new)
os.system('systemctl reload caddy 2>/dev/null || true')
print('    Caddy routes updated')
