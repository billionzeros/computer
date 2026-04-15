# anton.computer — Goals & Vision

## The End State

A world where every person and team has an AI agent running on their own server, 24/7, doing real work — not chatting about it. You open your desktop app in the morning and your agent has already:

- Written your weekly newsletter draft
- Monitored your servers and fixed a disk space issue at 3am
- Deployed the latest commit after tests passed
- Scraped competitor pricing and updated your spreadsheet
- Set up the staging environment your teammate requested yesterday

This is not a future where you talk to an AI. This is a future where AI works for you while you sleep.

---

## V0.1 — "It Works" (NOW)

**Goal: One person can install an agent on a VPS and give it tasks from a desktop app.**

Ship:
- [x] Agent daemon with pi SDK brain + 5 tools (shell, fs, browser, process, network)
- [x] Desktop app with connect screen, routine chat, terminal
- [x] WebSocket pipe protocol (multiplexed, binary framing)
- [x] Skills system (YAML files → AI workers)
- [x] Scheduler (skills run on cron — 24/7 autonomous work)
- [x] Dangerous command confirmation flow
- [ ] pnpm install && it runs
- [ ] OrbStack local testing flow works end-to-end
- [ ] First real task completed: "install nginx on my VPS from the desktop app"

**Success metric:** Record a 2-minute demo video of connecting to a VPS and having the agent deploy an app.

---

## V0.2 — "It's Useful" (~4 weeks after v0.1)

**Goal: People use it daily. Skills are the killer feature.**

Ship:
- [ ] 10+ pre-built skills (CMO, Content Writer, DevOps, Researcher, Data Analyst, SEO, Social Media, Email Manager, Code Reviewer, Meeting Notes)
- [ ] Skill marketplace — community-contributed YAML files
- [ ] File browser in desktop app (browse remote FS, upload/download)
- [ ] Port forwarding (remote port → localhost)
- [ ] Playwright integration for full browser automation
- [ ] Ollama integration tested and documented (run local models on VPS)
- [ ] Multi-machine support (manage 3+ servers from one app)
- [ ] Native notifications (agent finished task → macOS notification)
- [ ] Session history — browse past conversations and results

**Success metric:** 5 people using it daily for real work, not just testing.

---

## V0.3 — "It's Reliable" (~8 weeks)

**Goal: Production-grade. People trust it to run unsupervised.**

Ship:
- [ ] Sandboxing — bubblewrap (Linux) / sandbox-exec (macOS) for tool execution
- [ ] Network proxy — outbound allowlist, deny by default
- [ ] Audit dashboard — view what the agent did, when, and why
- [ ] Agent memory — persists knowledge across sessions (what it learned about your server, your preferences)
- [ ] Webhook triggers — GitHub push → agent deploys, email received → agent processes
- [ ] Health monitoring dashboard — agent reports its own health
- [ ] Auto-update agent — check for updates, apply without restart
- [ ] Error recovery — agent retries failed tasks, escalates to human when stuck

**Success metric:** Agent runs for 7 days straight without human intervention, completing scheduled skills correctly.

---

## V1.0 — "It's a Product" (~16 weeks)

**Goal: Open source release. People star it, fork it, build on it.**

Ship:
- [ ] Polished desktop app (macOS + Windows + Linux builds)
- [ ] One-command install that actually works on every major VPS provider
- [ ] Documentation site at docs.anton.computer
- [ ] Plugin/tool SDK — anyone can write custom tools in TypeScript
- [ ] Skill SDK — template repo for creating and sharing skills
- [ ] Team features — shared machines, role-based access
- [ ] Broker/relay server — NAT traversal for agents behind firewalls
- [ ] GitHub Actions integration — CI/CD triggers agent tasks
- [ ] VS Code extension — connect to agent from your editor
- [ ] API — programmatic access to agent (for building on top)

**Success metric:** 1,000+ GitHub stars, 50+ community-contributed skills.

---

## V2.0 — "It's a Platform" (6+ months)

**Goal: anton.computer becomes the default way to run AI agents on your own infrastructure.**

Vision:
- [ ] Multi-agent orchestration — agents that delegate to other agents
- [ ] Agent-to-agent communication — your content agent asks your research agent for data
- [ ] GPU support — attach GPUs, run local models, fine-tune on your data
- [ ] Managed offering at anton.computer — sign up, get a cloud computer, no VPS setup needed
- [ ] Enterprise tier — SSO, audit logs, compliance, SOC2
- [ ] Mobile app — check on your agents from your phone
- [ ] Voice interface — talk to your agent
- [ ] Marketplace with paid skills — creators earn revenue

**Success metric:** 10,000+ users, self-sustaining community, revenue from managed tier.

---

## Core Principles (Don't Compromise)

1. **The agent DOES things.** Every feature we ship must result in real actions on real infrastructure. If it only generates text, it's not good enough.

2. **Skills are trivially easy.** If adding a new AI worker takes more than writing a YAML file, we failed. The power is in how easy it is to extend.

3. **24/7 is the differentiator.** The agent works while you sleep. Scheduled skills, autonomous operation, self-healing — this is what makes it worth paying for.

4. **Your server, your data.** We never see your data. The agent runs on YOUR infrastructure. This isn't negotiable.

5. **Ship fast, iterate faster.** Don't over-engineer. The v0.1 agent loop is ~200 lines. Keep it simple. Add complexity only when users demand it.

6. **Open source is the distribution.** No one trusts a closed-source agent with root access to their server. Open source is not a nice-to-have, it's a requirement.

---

## Competitive Landscape

| Product | What they do | Why we're different |
|---------|-------------|-------------------|
| **Claude Projects** | AI chat with context | Can't execute. Can't share. Can't run 24/7. |
| **ChatGPT Codex** | AI coding agent | Locked to OpenAI. Cloud-only. No skills system. |
| **Zo Computer** | Personal AI cloud | Closed source. Black box server. No extensibility. |
| **OpenClaw** | Open source AI agent | Framework, not product. No desktop app. No VPS focus. |
| **Cursor / Windsurf** | AI code editors | Code-only. Can't manage servers, deploy, monitor. |
| **n8n / Make** | Automation platforms | Visual workflow builders. Not agentic. Not AI-native. |

**anton.computer sits in the gap:** open source + self-hosted + agentic + 24/7 + easy skills. No one else does all five.

---

## What This Becomes

The README says "your personal cloud computer." But the real vision is bigger:

**Every professional has an AI team working for them, running on infrastructure they control.**

- The marketer has an AI CMO, an AI Content Writer, and an AI Social Media Manager — all running as skills on a $20/mo server.
- The developer has an AI DevOps, an AI Code Reviewer, and an AI QA Tester.
- The founder has an AI Researcher, an AI Data Analyst, and an AI Executive Assistant.

They all run on anton.computer. They all cost a fraction of hiring. They all work 24/7. And the user owns the infrastructure, the data, and the output.

That's the goal. Everything we ship gets us closer to that.
