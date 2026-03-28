# ──────────────────────────────────────────────────────────────────
# Anton Agent - Deployment Makefile
# ──────────────────────────────────────────────────────────────────

ANSIBLE_DIR := deploy/ansible
PLAYBOOK   := $(ANSIBLE_DIR)/playbook.yml
INVENTORY  := $(ANSIBLE_DIR)/inventory.ini
EXTRA_ARGS ?=
REPO_ROOT  := $(shell pwd)

# Pass API key:        make deploy API_KEY=sk-ant-...
# Deploy a branch:     make deploy BRANCH=dev
# Target one host:     make deploy HOST=agent1
ifdef API_KEY
  EXTRA_ARGS += -e "anthropic_api_key=$(API_KEY)"
endif
ifdef BRANCH
  EXTRA_ARGS += -e "anton_branch=$(BRANCH)"
endif
ifdef HOST
  LIMIT := -l $(HOST)
endif

# ── Commands ─────────────────────────────────────────────────────

.PHONY: deploy update sync push release preflight verify status logs restart stop ping check setup help

## preflight: Verify all CI build steps pass locally before releasing
preflight:
	@./scripts/preflight.sh

## release: Ship a new version (bumps versions, changelog, tags, pushes, triggers CI)
release:
	@echo ""
	@CURRENT=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)"); \
	MAJOR=$$(echo $$CURRENT | cut -d. -f1); \
	MINOR=$$(echo $$CURRENT | cut -d. -f2); \
	PATCH=$$(echo $$CURRENT | cut -d. -f3); \
	NEXT_PATCH="$$MAJOR.$$MINOR.$$((PATCH + 1))"; \
	NEXT_MINOR="$$MAJOR.$$((MINOR + 1)).0"; \
	echo "  Current version: $$CURRENT"; \
	echo ""; \
	echo "  Suggestions:"; \
	echo "    patch → $$NEXT_PATCH"; \
	echo "    minor → $$NEXT_MINOR"; \
	echo ""; \
	read -p "  New version [$$NEXT_PATCH]: " VERSION; \
	VERSION=$${VERSION:-$$NEXT_PATCH}; \
	echo ""; \
	./scripts/release.sh "$$VERSION" --push

## deploy: Full deploy to all hosts in inventory (or HOST=name for one)
deploy: _check-ansible
	ansible-playbook $(PLAYBOOK) -i $(INVENTORY) $(LIMIT) $(EXTRA_ARGS) -v

## update: Pull latest from remote repo, rebuild, and restart on all hosts
update: _check-ansible
	ansible-playbook $(PLAYBOOK) -i $(INVENTORY) $(LIMIT) $(EXTRA_ARGS) --tags build -v

## sync: Rsync local code to VPS, rebuild, and restart (no git push needed)
sync: _check-ansible
	@echo ""
	@echo "  Syncing local code to VPS..."
	@echo "  ────────────────────────────"
	@echo "  Source: $(REPO_ROOT)"
	@echo ""
	@GIT_HASH=$$(cd "$(REPO_ROOT)" && git rev-parse --short HEAD 2>/dev/null || echo "dev"); \
	PKG_VERSION=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(REPO_ROOT)/packages/agent/package.json','utf8')).version)" 2>/dev/null || echo "0.1.0"); \
	ansible all -i $(INVENTORY) $(LIMIT) --list-hosts 2>/dev/null | tail -n +2 | sed 's/^ *//' | while read host; do \
		IP=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_host','$$host'))" 2>/dev/null || echo "$$host"); \
		USER=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_user','anton'))" 2>/dev/null || echo "anton"); \
		KEY=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_ssh_private_key_file',''))" 2>/dev/null || echo ""); \
		REMOTE_DIR="/home/anton/.anton/agent"; \
		STAGING_DIR="/tmp/anton-sync"; \
		echo "  → $$host ($$IP) as $$USER"; \
		RSYNC_RSH="ssh -o StrictHostKeyChecking=no"; \
		SSH_OPTS="-o StrictHostKeyChecking=no"; \
		SCP_OPTS="-o StrictHostKeyChecking=no"; \
		if [ -n "$$KEY" ]; then RSYNC_RSH="$$RSYNC_RSH -i $$KEY"; SSH_OPTS="$$SSH_OPTS -i $$KEY"; SCP_OPTS="$$SCP_OPTS -i $$KEY"; fi; \
		rsync -az --delete \
			--exclude node_modules \
			--exclude .git \
			--exclude dist \
			--exclude 'packages/desktop/src-tauri/target' \
			-e "$$RSYNC_RSH" \
			"$(REPO_ROOT)/" "$$USER@$$IP:$$STAGING_DIR/"; \
		echo "  → Moving to $$REMOTE_DIR..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "\
			sudo rsync -a --delete \
				--exclude node_modules \
				--exclude dist \
				$$STAGING_DIR/ $$REMOTE_DIR/ && \
			sudo chown -R anton:anton $$REMOTE_DIR && \
			rm -rf $$STAGING_DIR"; \
		echo "  → Building agent on $$host..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "\
			sudo -u anton bash -c '\
				cd $$REMOTE_DIR && \
				pnpm install --no-frozen-lockfile 2>&1 | tail -3 && \
				pnpm --filter @anton/protocol build && \
				pnpm --filter @anton/agent-config build && \
				pnpm --filter @anton/agent-core build && \
				pnpm --filter @anton/agent-server build && \
				pnpm --filter @anton/agent build && \
				echo $$GIT_HASH build done'"; \
		echo "  → Building sidecar (linux-amd64)..."; \
		cd "$(REPO_ROOT)/sidecar" && GOOS=linux GOARCH=amd64 go build -ldflags "-s -w -X main.version=$$PKG_VERSION" -o /tmp/anton-sidecar . && cd "$(REPO_ROOT)"; \
		echo "  → Uploading sidecar to $$host..."; \
		scp $$SCP_OPTS /tmp/anton-sidecar "$$USER@$$IP:/tmp/anton-sidecar"; \
		ssh $$SSH_OPTS "$$USER@$$IP" "\
			sudo mv /tmp/anton-sidecar /usr/local/bin/anton-sidecar && \
			sudo chmod +x /usr/local/bin/anton-sidecar && \
			if [ ! -f /etc/anton-agent.env ]; then \
				TOKEN=\$$(grep '^token:' /home/anton/.anton/config.yaml 2>/dev/null | awk '{print \$$2}'); \
				printf 'ANTON_TOKEN=%s\nANTON_DIR=/home/anton/.anton\n' \"\$$TOKEN\" | sudo tee /etc/anton-agent.env > /dev/null; \
				sudo chmod 600 /etc/anton-agent.env; \
				echo '    Created /etc/anton-agent.env'; \
			fi && \
			if [ ! -f /etc/systemd/system/anton-sidecar.service ]; then \
				printf '[Unit]\nDescription=Anton Sidecar (Health & Status)\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nEnvironmentFile=/etc/anton-agent.env\nEnvironment=SIDECAR_PORT=9878\nEnvironment=AGENT_PORT=9876\nExecStart=/usr/local/bin/anton-sidecar\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=multi-user.target\n' | sudo tee /etc/systemd/system/anton-sidecar.service > /dev/null && \
				sudo systemctl daemon-reload && sudo systemctl enable anton-sidecar; \
			fi && \
			sudo systemctl restart anton-sidecar 2>/dev/null || true"; \
		echo "  → Writing version.json..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "\
			sudo -u anton bash -c \"echo '{\\\"version\\\": \\\"$$PKG_VERSION\\\", \\\"gitHash\\\": \\\"$$GIT_HASH\\\", \\\"branch\\\": \\\"local-sync\\\", \\\"deployedAt\\\": \\\"$$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\", \\\"deployedBy\\\": \\\"sync\\\"}' > /home/anton/.anton/version.json\""; \
		echo "  → Ensuring Caddy sidecar route..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "\
			if [ -f /etc/caddy/Caddyfile ] && ! grep -q '_anton' /etc/caddy/Caddyfile; then \
				sudo sed -i 's|reverse_proxy localhost:9876|handle_path /_anton/* {\n        reverse_proxy localhost:9878\n    }\n    reverse_proxy localhost:9876|' /etc/caddy/Caddyfile && \
				sudo systemctl reload caddy 2>/dev/null || true; \
				echo '    Caddyfile updated with sidecar route'; \
			fi"; \
		echo "  → Restarting services on $$host..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "sudo systemctl restart anton-agent 2>/dev/null || true; sudo systemctl restart anton-sidecar 2>/dev/null || true"; \
		echo "  → $$host done ✓"; \
		echo ""; \
	done
	@echo "  Sync complete. Run 'make verify' to check."
	@echo ""

## push: Bundle agent → scp to VPS → restart (fast dev deploy, ~5 seconds)
push: _check-ansible
	@echo ""
	@echo "  Bundling and pushing to VPS..."
	@echo "  ──────────────────────────────"
	@echo ""
	@./scripts/bundle.sh
	@BUNDLE="dist/anton-agent.mjs"; \
	GIT_HASH=$$(git rev-parse --short HEAD 2>/dev/null || echo "dev"); \
	PKG_VERSION=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)" 2>/dev/null || echo "0.1.0"); \
	ansible all -i $(INVENTORY) $(LIMIT) --list-hosts 2>/dev/null | tail -n +2 | sed 's/^ *//' | while read host; do \
		IP=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_host','$$host'))" 2>/dev/null || echo "$$host"); \
		USER=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_user','anton'))" 2>/dev/null || echo "anton"); \
		KEY=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_ssh_private_key_file',''))" 2>/dev/null || echo ""); \
		SSH_OPTS="-o StrictHostKeyChecking=no"; \
		SCP_OPTS="-o StrictHostKeyChecking=no"; \
		if [ -n "$$KEY" ]; then SSH_OPTS="$$SSH_OPTS -i $$KEY"; SCP_OPTS="$$SCP_OPTS -i $$KEY"; fi; \
		echo "  → $$host ($$IP)"; \
		echo "    Uploading bundle..."; \
		scp $$SCP_OPTS "$$BUNDLE" "$$USER@$$IP:/tmp/anton-agent.mjs"; \
		echo "    Installing + restarting..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "\
			sudo mv /tmp/anton-agent.mjs /home/anton/.anton/anton-agent.mjs && \
			sudo chmod +x /home/anton/.anton/anton-agent.mjs && \
			sudo chown anton:anton /home/anton/.anton/anton-agent.mjs && \
			sudo -u anton bash -c \"echo '{\\\"version\\\": \\\"$$PKG_VERSION\\\", \\\"gitHash\\\": \\\"$$GIT_HASH\\\", \\\"deployedAt\\\": \\\"$$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)\\\", \\\"deployedBy\\\": \\\"push\\\"}' > /home/anton/.anton/version.json\" && \
			sudo systemctl restart anton-agent 2>/dev/null || true"; \
		echo "    $$host done ✓"; \
		echo ""; \
	done
	@echo "  Push complete. Run 'make verify' to check."
	@echo ""

## verify: Health check across all hosts (or HOST=name for one)
verify: _check-ansible
	@echo ""
	@ansible all -i $(INVENTORY) $(LIMIT) --list-hosts 2>/dev/null | tail -n +2 | sed 's/^ *//' | while read host; do \
		IP=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('ansible_host','$$host'))" 2>/dev/null || echo "$$host"); \
		USER=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_user','anton'))" 2>/dev/null || echo "anton"); \
		KEY=$$(ansible-inventory -i $(INVENTORY) --host "$$host" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ansible_ssh_private_key_file',''))" 2>/dev/null || echo ""); \
		SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5"; \
		if [ -n "$$KEY" ]; then SSH_OPTS="$$SSH_OPTS -i $$KEY"; fi; \
		echo "  ┌──────────────────────────────────────────────────────────────┐"; \
		printf "  │  %-60s│\n" "$$host ($$IP)"; \
		echo "  ├──────────────────────────────────────────────────────────────┤"; \
		REMOTE=$$(ssh $$SSH_OPTS "$$USER@$$IP" '\
			STATUS="✗ DOWN"; PID="-"; MEM="-"; UPTIME="-"; \
			if systemctl is-active anton-agent >/dev/null 2>&1; then \
				STATUS="✓ RUNNING"; \
				PID=$$(systemctl show anton-agent --property=MainPID --value); \
				MEM=$$(systemctl show anton-agent --property=MemoryCurrent --value | numfmt --to=iec 2>/dev/null || echo "?"); \
				RAW_TS=$$(systemctl show anton-agent --property=ActiveEnterTimestamp --value); \
				if [ -n "$$RAW_TS" ] && command -v date >/dev/null 2>&1; then \
					START_EPOCH=$$(date -d "$$RAW_TS" +%s 2>/dev/null || echo 0); \
					NOW_EPOCH=$$(date +%s); \
					DIFF=$$((NOW_EPOCH - START_EPOCH)); \
					DAYS=$$((DIFF / 86400)); HRS=$$(( (DIFF % 86400) / 3600 )); MINS=$$(( (DIFF % 3600) / 60 )); \
					if [ $$DAYS -gt 0 ]; then UPTIME="$${DAYS}d $${HRS}h"; \
					elif [ $$HRS -gt 0 ]; then UPTIME="$${HRS}h $${MINS}m"; \
					else UPTIME="$${MINS}m"; fi; \
				fi; \
			fi; \
			PORT9876="✗"; PORT9877="✗"; SIDECAR="✗ DOWN"; \
			ss -tlnp 2>/dev/null | grep -q ":9876" && PORT9876="✓"; \
			ss -tlnp 2>/dev/null | grep -q ":9877" && PORT9877="✓"; \
			if systemctl is-active anton-sidecar >/dev/null 2>&1; then SIDECAR="✓ RUNNING"; fi; \
			VER="-"; HASH="-"; BRANCH="-"; DEPLOYED="-"; VIA="-"; \
			if [ -f /home/anton/.anton/version.json ] && command -v jq >/dev/null 2>&1; then \
				VER=$$(jq -r ".version // \"-\"" /home/anton/.anton/version.json); \
				HASH=$$(jq -r ".gitHash // \"-\"" /home/anton/.anton/version.json); \
				BRANCH=$$(jq -r ".branch // \"-\"" /home/anton/.anton/version.json); \
				DEPLOYED=$$(jq -r ".deployedAt // \"-\"" /home/anton/.anton/version.json); \
				VIA=$$(jq -r ".deployedBy // \"-\"" /home/anton/.anton/version.json); \
			fi; \
			AGENTID="-"; TOKEN="-"; \
			if [ -f /home/anton/.anton/config.yaml ]; then \
				AGENTID=$$(grep "^agentId:" /home/anton/.anton/config.yaml | awk "{print \$$2}"); \
				TOKEN=$$(grep "^token:" /home/anton/.anton/config.yaml | awk "{print \$$2}"); \
			fi; \
			NODE_VER=$$(node --version 2>/dev/null || echo "missing"); \
			echo "$$STATUS|$$PID|$$MEM|$$UPTIME|$$PORT9876|$$PORT9877|$$SIDECAR|$$VER|$$HASH|$$BRANCH|$$DEPLOYED|$$VIA|$$AGENTID|$$TOKEN|$$NODE_VER" \
		' 2>/dev/null) || REMOTE="? UNREACHABLE via SSH||||||||||||||"; \
		IFS="|" read -r R_STATUS R_PID R_MEM R_UPTIME R_P9876 R_P9877 R_SIDECAR R_VER R_HASH R_BRANCH R_DEPLOYED R_VIA R_AID R_TOKEN R_NODE <<< "$$REMOTE"; \
		printf "  │  %-18s %-40s│\n" "Service:" "$$R_STATUS"; \
		printf "  │  %-18s %-40s│\n" "PID / Memory:" "$$R_PID / $$R_MEM"; \
		printf "  │  %-18s %-40s│\n" "Uptime:" "$$R_UPTIME"; \
		printf "  │  %-18s %-40s│\n" "Ports:" "9876 $$R_P9876  9877 $$R_P9877"; \
		printf "  │  %-18s %-40s│\n" "Sidecar:" "$$R_SIDECAR"; \
		printf "  │  %-18s %-40s│\n" "Node.js:" "$$R_NODE"; \
		echo "  │                                                              │"; \
		printf "  │  %-18s %-40s│\n" "Version:" "$$R_VER ($$R_HASH)"; \
		printf "  │  %-18s %-40s│\n" "Branch:" "$$R_BRANCH"; \
		printf "  │  %-18s %-40s│\n" "Deployed:" "$$R_DEPLOYED via $$R_VIA"; \
		echo "  │                                                              │"; \
		printf "  │  %-18s %-40s│\n" "Agent ID:" "$$R_AID"; \
		printf "  │  %-18s %-40s│\n" "Token:" "$$R_TOKEN"; \
		echo "  │                                                              │"; \
		printf "  │  %-18s " "Reachable:"; \
		if nc -z -w 3 "$$IP" 9876 2>/dev/null; then \
			printf "%-40s│\n" "✓ from this machine"; \
		else \
			printf "%-40s│\n" "✗ port 9876 not reachable"; \
		fi; \
		echo "  └──────────────────────────────────────────────────────────────┘"; \
		echo ""; \
	done

## status: Check if anton-agent service is running on all hosts
status: _check-ansible
	ansible all -i $(INVENTORY) $(LIMIT) -m shell -a "systemctl status anton-agent --no-pager" --become

## logs: Tail the last 50 lines of agent logs on all hosts
logs: _check-ansible
	ansible all -i $(INVENTORY) $(LIMIT) -m shell -a "journalctl -u anton-agent --no-pager -n 50" --become

## restart: Restart the agent on all hosts
restart: _check-ansible
	ansible all -i $(INVENTORY) $(LIMIT) -m systemd -a "name=anton-agent state=restarted" --become

## stop: Stop the agent on all hosts
stop: _check-ansible
	ansible all -i $(INVENTORY) $(LIMIT) -m systemd -a "name=anton-agent state=stopped" --become

## ping: Test SSH connectivity to all hosts
ping: _check-ansible
	ansible all -i $(INVENTORY) $(LIMIT) -m ping

## check: Dry-run the playbook (no changes made)
check: _check-ansible
	ansible-playbook $(PLAYBOOK) -i $(INVENTORY) $(LIMIT) $(EXTRA_ARGS) --check --diff

## setup: Install Ansible on this machine (macOS/Linux)
setup:
	@if command -v ansible-playbook >/dev/null 2>&1; then \
		echo "Ansible is already installed: $$(ansible --version | head -1)"; \
	elif command -v brew >/dev/null 2>&1; then \
		echo "Installing Ansible via Homebrew..."; \
		brew install ansible; \
	elif command -v pip3 >/dev/null 2>&1; then \
		echo "Installing Ansible via pip..."; \
		pip3 install ansible; \
	elif command -v apt-get >/dev/null 2>&1; then \
		echo "Installing Ansible via apt..."; \
		sudo apt-get update && sudo apt-get install -y ansible; \
	else \
		echo "Could not auto-install Ansible. Install manually: https://docs.ansible.com/ansible/latest/installation_guide/"; \
		exit 1; \
	fi

## help: Show this help
help:
	@echo ""
	@echo "  Anton Agent - Deployment"
	@echo "  ────────────────────────"
	@echo ""
	@echo "  Setup:"
	@echo "    1. Edit inventory.ini with your VPS IPs and SSH key"
	@echo "    2. make deploy"
	@echo ""
	@echo "  Targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /' | column -t -s ':'
	@echo ""
	@echo "  Options:"
	@echo "    HOST=agent1           Target a single host from inventory"
	@echo "    API_KEY=sk-ant-...    Pass Anthropic API key"
	@echo "    BRANCH=dev            Deploy a specific git branch"
	@echo ""
	@echo "  Examples:"
	@echo "    make deploy"
	@echo "    make deploy HOST=agent1 API_KEY=sk-ant-api03-xxxxx"
	@echo "    make deploy BRANCH=staging"
	@echo "    make release                 # ship new version (interactive)"
	@echo "    make push                    # build bundle + scp to VPS (fast)"
	@echo "    make push HOST=agent1        # push to one host"
	@echo "    make sync                    # rsync source code → VPS (legacy)"
	@echo "    make sync HOST=agent1        # sync to one host"
	@echo "    make status"
	@echo "    make logs HOST=agent2"
	@echo "    make restart"
	@echo ""

# ── Internal ─────────────────────────────────────────────────────

_check-ansible:
	@command -v ansible-playbook >/dev/null 2>&1 || { echo "Ansible not found. Run: make setup"; exit 1; }

.DEFAULT_GOAL := help
