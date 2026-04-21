#!/usr/bin/env python3
"""Ensure Anton's Caddy routes are present. Safe to re-run."""
import os, sys

f = '/etc/caddy/Caddyfile'
if not os.path.exists(f):
    print('    No Caddyfile found, skipping')
    sys.exit(0)

content = open(f).read()
# Canary strings that only exist in the current layout. Two older shapes
# need to be rewritten:
#   1. `handle_path /_anton/*` wildcard — dumped everything to the sidecar,
#      breaking /_anton/webhooks/* and /_anton/proxy/notify.
#   2. `handle_path /_anton/status` (and /health) — strips the *entire* path
#      leaving "/" upstream. Sidecar has no `/` route, so the request falls
#      through to the BearerAuth group and returns "missing authorization
#      header". The fix is `handle` + `uri strip_prefix /_anton`.
checks = ['_anton/health', '_anton/status', '/a/*', '/p/*', 'uri strip_prefix /_anton']
bad_markers = ['handle_path /_anton/*', 'handle_path /_anton/status', 'handle_path /_anton/health']
if all(c in content for c in checks) and not any(b in content for b in bad_markers):
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
    #
    # Use `handle` + `uri strip_prefix /_anton` (not `handle_path`).
    # handle_path strips the *entire* matched path, which would turn
    # /_anton/status into "/" upstream — sidecar has no route for /, so
    # it falls through to the BearerAuth group and returns 401.
    handle /_anton/health {{
        uri strip_prefix /_anton
        reverse_proxy localhost:9878
    }}
    handle /_anton/status {{
        uri strip_prefix /_anton
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
