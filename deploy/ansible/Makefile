# ──────────────────────────────────────────────────────────────────
# Anton Agent - Deployment Makefile
# ──────────────────────────────────────────────────────────────────
#
# Setup:
#   1. Edit inventory.ini — add your VPS IPs, SSH key, and user
#   2. Run: make deploy
#
# That's it.
# ──────────────────────────────────────────────────────────────────

PLAYBOOK   := playbook.yml
INVENTORY  := inventory.ini
EXTRA_ARGS ?=

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

.PHONY: deploy update status logs restart stop ping check setup help

## deploy: Full deploy to all hosts in inventory (or HOST=name for one)
deploy: _check-ansible
	ansible-playbook $(PLAYBOOK) -i $(INVENTORY) $(LIMIT) $(EXTRA_ARGS) -v

## update: Pull latest code, rebuild, and restart on all hosts
update: _check-ansible
	ansible-playbook $(PLAYBOOK) -i $(INVENTORY) $(LIMIT) $(EXTRA_ARGS) --tags build -v

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
	@echo "    make status"
	@echo "    make logs HOST=agent2"
	@echo "    make restart"
	@echo ""

# ── Internal ─────────────────────────────────────────────────────

_check-ansible:
	@command -v ansible-playbook >/dev/null 2>&1 || { echo "Ansible not found. Run: make setup"; exit 1; }

.DEFAULT_GOAL := help
