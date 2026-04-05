# ──────────────────────────────────────────────────────────────────
# Anton Agent - Deployment (repo-clone model)
#
# All deployment uses the same model: the full repo lives on the
# server at /opt/anton. The agent runs via `node dist/index.js`.
# ──────────────────────────────────────────────────────────────────

ANSIBLE_DIR := deploy/ansible
PLAYBOOK   := $(ANSIBLE_DIR)/playbook.yml
INVENTORY  := $(ANSIBLE_DIR)/inventory.ini
EXTRA_ARGS ?=
REPO_ROOT  := $(shell pwd)
REMOTE_REPO := /opt/anton

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

.PHONY: sync deploy update verify status logs restart stop ping check setup release preflight help \
       eval eval-tools eval-safety eval-quality eval-code eval-planning eval-context eval-chat \
       eval-lead-scanner eval-lead-scorer eval-outreach-writer eval-workflows eval-dry

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

## deploy: Full deploy to all hosts via Ansible playbook
deploy: _check-ansible
	ansible-playbook $(PLAYBOOK) -i $(INVENTORY) $(LIMIT) $(EXTRA_ARGS) -v

## update: Pull latest + rebuild on all hosts (via Ansible)
update: _check-ansible
	ansible-playbook $(PLAYBOOK) -i $(INVENTORY) $(LIMIT) $(EXTRA_ARGS) --tags build -v

## sync: Build locally → rsync to VPS → restart (fast dev deploy, no git push needed)
sync: _check-ansible
	@GIT_HASH=$$(git rev-parse --short HEAD 2>/dev/null || echo "dev"); \
	PKG_VERSION=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(REPO_ROOT)/package.json','utf8')).version)" 2>/dev/null || echo "0.1.0"); \
	echo ""; \
	echo "  ┌─────────────────────────────────────┐"; \
	echo "  │  sync → v$$PKG_VERSION ($$GIT_HASH)"; \
	echo "  └─────────────────────────────────────┘"; \
	echo ""; \
	echo "  ○ Building locally..."; \
	pnpm -r build 2>&1 | tail -3; \
	echo "  ✓ Build complete"; \
	echo ""; \
	grep -E '^\w+\s+ansible_host=' $(INVENTORY) | while read line; do \
		host=$$(echo "$$line" | awk '{print $$1}'); \
		IP=$$(echo "$$line" | sed -n 's/.*ansible_host=\([^ ]*\).*/\1/p'); \
		USER=$$(echo "$$line" | sed -n 's/.*ansible_user=\([^ ]*\).*/\1/p'); \
		USER=$${USER:-anton}; \
		KEY=$$(echo "$$line" | sed -n 's/.*ansible_ssh_private_key_file=\([^ ]*\).*/\1/p'); \
		KEY=$$(eval echo "$$KEY"); \
		SSH_KEY_OPT=""; if [ -n "$$KEY" ]; then SSH_KEY_OPT="-i $$KEY"; fi; \
		SSH_OPTS="-o StrictHostKeyChecking=no $$SSH_KEY_OPT"; \
		echo "  ── $$host ($$IP) ──"; \
		echo "  ○ Preparing remote directory..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "sudo mkdir -p $(REMOTE_REPO) && sudo chown -R anton:anton $(REMOTE_REPO)" 2>&1; \
		echo "  ○ Rsyncing code + dependencies..."; \
		rsync -az --delete \
			--exclude='.git' \
			--exclude='.DS_Store' \
			--exclude='.turbo' \
			--exclude='packages/desktop' \
			--rsync-path="sudo -u anton rsync" \
			-e "ssh $$SSH_OPTS" \
			"$(REPO_ROOT)/" "$$USER@$$IP:$(REMOTE_REPO)/" 2>&1; \
		echo "  ○ Rebuilding native modules on remote..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "cd $(REMOTE_REPO) && sudo -u anton bash -c 'cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npx --yes prebuild-install || npx --yes node-gyp rebuild --release' 2>&1" || true; \
		echo "  ○ Writing systemd service..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "printf '[Unit]\nDescription=Anton Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=anton\nGroup=anton\nEnvironmentFile=/home/anton/.anton/agent.env\nWorkingDirectory=$(REMOTE_REPO)\nExecStart=/usr/bin/node $(REMOTE_REPO)/packages/agent-server/dist/index.js\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n' | sudo tee /etc/systemd/system/anton-agent.service > /dev/null"; \
		echo "  ○ Writing version info..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "sudo -u anton bash -c \"echo '{\\\"version\\\": \\\"$$PKG_VERSION\\\", \\\"gitHash\\\": \\\"$$GIT_HASH\\\", \\\"deployedAt\\\": \\\"$$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\", \\\"deployedBy\\\": \\\"sync\\\"}' > /home/anton/.anton/version.json\""; \
		echo "  ○ Restarting service..."; \
		ssh $$SSH_OPTS "$$USER@$$IP" "sudo systemctl daemon-reload && sudo systemctl restart anton-agent"; \
		sleep 2; \
		RUNNING=$$(ssh $$SSH_OPTS "$$USER@$$IP" "systemctl is-active anton-agent 2>/dev/null" || echo "failed"); \
		if [ "$$RUNNING" = "active" ]; then \
			echo "  ✓ anton-agent is running"; \
		else \
			echo "  ✗ anton-agent FAILED to start"; \
			ssh $$SSH_OPTS "$$USER@$$IP" "sudo journalctl -u anton-agent --no-pager -n 15" 2>/dev/null; \
		fi; \
		echo ""; \
	done
	@echo "  Done. Run 'make verify' to check."
	@echo ""

## verify: Health check across all hosts
verify: _check-ansible
	@echo ""
	@grep -E '^\w+\s+ansible_host=' $(INVENTORY) | while read line; do \
		host=$$(echo "$$line" | awk '{print $$1}'); \
		IP=$$(echo "$$line" | sed -n 's/.*ansible_host=\([^ ]*\).*/\1/p'); \
		USER=$$(echo "$$line" | sed -n 's/.*ansible_user=\([^ ]*\).*/\1/p'); \
		USER=$${USER:-anton}; \
		KEY=$$(echo "$$line" | sed -n 's/.*ansible_ssh_private_key_file=\([^ ]*\).*/\1/p'); \
		KEY=$$(eval echo "$$KEY"); \
		SSH_KEY_OPT=""; if [ -n "$$KEY" ]; then SSH_KEY_OPT="-i $$KEY"; fi; \
		SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5 $$SSH_KEY_OPT"; \
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
			VER="-"; HASH="-"; DEPLOYED="-"; VIA="-"; \
			if [ -f /home/anton/.anton/version.json ] && command -v jq >/dev/null 2>&1; then \
				VER=$$(jq -r ".version // \"-\"" /home/anton/.anton/version.json); \
				HASH=$$(jq -r ".gitHash // \"-\"" /home/anton/.anton/version.json); \
				DEPLOYED=$$(jq -r ".deployedAt // \"-\"" /home/anton/.anton/version.json); \
				VIA=$$(jq -r ".deployedBy // \"-\"" /home/anton/.anton/version.json); \
			fi; \
			AGENTID="-"; TOKEN="-"; \
			if [ -f /home/anton/.anton/config.yaml ]; then \
				AGENTID=$$(grep "^agentId:" /home/anton/.anton/config.yaml | awk "{print \$$2}"); \
				TOKEN=$$(grep "^token:" /home/anton/.anton/config.yaml | awk "{print \$$2}"); \
			fi; \
			NODE_VER=$$(node --version 2>/dev/null || echo "missing"); \
			REPO_EXISTS="✗"; [ -d /opt/anton/packages ] && REPO_EXISTS="✓"; \
			echo "$$STATUS|$$PID|$$MEM|$$UPTIME|$$PORT9876|$$PORT9877|$$SIDECAR|$$VER|$$HASH|$$DEPLOYED|$$VIA|$$AGENTID|$$TOKEN|$$NODE_VER|$$REPO_EXISTS" \
		' 2>/dev/null) || REMOTE="? UNREACHABLE via SSH||||||||||||||"; \
		IFS="|" read -r R_STATUS R_PID R_MEM R_UPTIME R_P9876 R_P9877 R_SIDECAR R_VER R_HASH R_DEPLOYED R_VIA R_AID R_TOKEN R_NODE R_REPO <<< "$$REMOTE"; \
		printf "  │  %-18s %-40s│\n" "Service:" "$$R_STATUS"; \
		printf "  │  %-18s %-40s│\n" "PID / Memory:" "$$R_PID / $$R_MEM"; \
		printf "  │  %-18s %-40s│\n" "Uptime:" "$$R_UPTIME"; \
		printf "  │  %-18s %-40s│\n" "Ports:" "9876 $$R_P9876  9877 $$R_P9877"; \
		printf "  │  %-18s %-40s│\n" "Sidecar:" "$$R_SIDECAR"; \
		printf "  │  %-18s %-40s│\n" "Node.js:" "$$R_NODE"; \
		printf "  │  %-18s %-40s│\n" "Repo:" "/opt/anton $$R_REPO"; \
		echo "  │                                                              │"; \
		printf "  │  %-18s %-40s│\n" "Version:" "$$R_VER ($$R_HASH)"; \
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

## env: Show agent.env contents on all hosts (redacts token values)
env: _check-ansible
	@echo ""
	@grep -E '^\w+\s+ansible_host=' $(INVENTORY) | while read line; do \
		host=$$(echo "$$line" | awk '{print $$1}'); \
		IP=$$(echo "$$line" | sed -n 's/.*ansible_host=\([^ ]*\).*/\1/p'); \
		USER=$$(echo "$$line" | sed -n 's/.*ansible_user=\([^ ]*\).*/\1/p'); \
		USER=$${USER:-anton}; \
		KEY=$$(echo "$$line" | sed -n 's/.*ansible_ssh_private_key_file=\([^ ]*\).*/\1/p'); \
		KEY=$$(eval echo "$$KEY"); \
		SSH_KEY_OPT=""; if [ -n "$$KEY" ]; then SSH_KEY_OPT="-i $$KEY"; fi; \
		SSH_OPTS="-o StrictHostKeyChecking=no $$SSH_KEY_OPT"; \
		echo "  ── $$host ($$IP) ──────────────────────────────────────────"; \
		ssh $$SSH_OPTS "$$USER@$$IP" "\
			ENV_PATH=\$$(grep EnvironmentFile /etc/systemd/system/anton-agent.service 2>/dev/null | cut -d= -f2 || echo '/home/anton/.anton/agent.env'); \
			echo \"  File: \$$ENV_PATH\"; \
			echo ''; \
			if sudo test -f \$$ENV_PATH; then \
				sudo cat \$$ENV_PATH | while IFS= read -r line; do \
					key=\$$(echo \"\$$line\" | cut -d= -f1); \
					val=\$$(echo \"\$$line\" | cut -d= -f2-); \
					case \"\$$key\" in \
						ANTON_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|*SECRET*|*PASSWORD*) \
							len=\$$(echo -n \"\$$val\" | wc -c); \
							printf '  %-35s %s\n' \"\$$key\" \"[set, \$${len} chars]\"; \
							;; \
						*) \
							printf '  %-35s %s\n' \"\$$key\" \"\$$val\"; \
							;; \
					esac; \
				done; \
			else \
				echo '  (file not found)'; \
			fi" 2>/dev/null; \
		echo ""; \
	done

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

# ── Evals ────────────────────────────────────────────────────────

EVAL_CMD := pnpm --filter @anton/agent-core

## eval: Run all eval suites (9 suites, 87 cases)
eval:
	$(EVAL_CMD) eval

## eval-dry: Validate all datasets without running LLM calls
eval-dry:
	$(EVAL_CMD) eval -- --dry-run

## eval-tools: Run tool selection evals (35 cases)
eval-tools:
	$(EVAL_CMD) eval:tools

## eval-safety: Run safety/refusal evals (16 cases)
eval-safety:
	$(EVAL_CMD) eval:safety

## eval-quality: Run response quality evals (10 cases)
eval-quality:
	$(EVAL_CMD) eval:quality

## eval-code: Run code generation evals (10 cases)
eval-code:
	$(EVAL_CMD) eval:code

## eval-planning: Run task planning evals (8 cases)
eval-planning:
	$(EVAL_CMD) eval:planning

## eval-context: Run context awareness evals (8 cases)
eval-context:
	$(EVAL_CMD) eval:context

## eval-chat: Run all chat evals — code + planning + context (26 cases)
eval-chat:
	$(EVAL_CMD) eval:chat

## eval-lead-scanner: Run lead scanner workflow evals (9 cases)
eval-lead-scanner:
	$(EVAL_CMD) eval:lead-scanner

## eval-lead-scorer: Run lead scorer workflow evals (9 cases)
eval-lead-scorer:
	$(EVAL_CMD) eval:lead-scorer

## eval-outreach-writer: Run outreach writer workflow evals (6 cases)
eval-outreach-writer:
	$(EVAL_CMD) eval:outreach-writer

## eval-workflows: Run all workflow evals (24 cases)
eval-workflows:
	$(EVAL_CMD) eval:workflows

# ── Help ─────────────────────────────────────────────────────────

## help: Show this help
help:
	@echo ""
	@echo "  Anton Agent - Deployment (repo-clone model)"
	@echo "  ────────────────────────────────────────────"
	@echo ""
	@echo "  All hosts run from /opt/anton (git repo clone)."
	@echo "  Agent runs via: node packages/agent-server/dist/index.js"
	@echo ""
	@echo "  Quick start:"
	@echo "    make sync                  Build locally + rsync to VPS + restart"
	@echo "    make sync HOST=agent1      Sync to one host only"
	@echo "    make verify                Health check all hosts"
	@echo ""
	@echo "  Evals:"
	@echo "    make eval                  Run all 9 eval suites (87 cases)"
	@echo "    make eval-dry              Dry run — validate datasets, no LLM calls"
	@echo "    make eval-chat             Chat quality (code + planning + context)"
	@echo "    make eval-workflows        Workflow agents (scanner + scorer + writer)"
	@echo ""
	@echo "  All targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /' | column -t -s ':'
	@echo ""

# ── Internal ─────────────────────────────────────────────────────

_check-ansible:
	@command -v ansible-playbook >/dev/null 2>&1 || { echo "Ansible not found. Run: make setup"; exit 1; }

.DEFAULT_GOAL := help
