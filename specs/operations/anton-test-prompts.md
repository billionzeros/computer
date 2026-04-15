# Anton Capability Test Prompts

> 30 real-world user prompts designed to naturally trigger sub_agent, ask_user, plan, and Anton's full tool suite.
> These are things actual users would ask — not developer/meta tasks.

---

## Category 1: Forces `ask_user` (User Needs Are Ambiguous)

### 1. Vague Automation Request
```
Set up something that monitors a website and alerts me when it changes.
```
**Must ask**: Which website? What kind of changes? Alert via notification/email/Slack? How often to check?

### 2. "Build Me an App"
```
I need a landing page for my side project.
```
**Must ask**: What's the project? What sections? Any branding/colors? Where to host? Do you have a domain?

### 3. Data Processing Without Details
```
I have a bunch of CSVs I need to clean up and combine.
```
**Must ask**: Where are the files? What does "clean up" mean (dedup? fix formats? remove nulls?)? Output format? Which columns to keep?

### 4. Open-Ended Research
```
Find me the best API for sending emails.
```
**Must ask**: Transactional or marketing? Volume? Budget? Need templates? Self-hosted or SaaS? Any you've tried?

### 5. Ambiguous File Task
```
Organize my downloads folder.
```
**Must ask**: Organize by type/date/project? Delete old files? What counts as "old"? Any folders to skip?

### 6. Schedule Without Specifics
```
Remind me to check on the deployment.
```
**Must ask**: When? Once or recurring? Which deployment? What should the reminder say? Notification or message?

---

## Category 2: Forces `plan` (Complex Multi-Step Work)

### 7. Full Workflow Setup
```
I want a daily standup summary — every morning, pull my GitHub commits from yesterday, any open PRs, and my calendar events, then write a summary and post it to Slack.
```
**Why plan**: Needs agent creation, GitHub API, calendar integration, Slack connector, scheduling — must plan the architecture.

### 8. Data Pipeline
```
Scrape job listings from 3 job boards for "AI engineer" roles, deduplicate them, score them based on my resume, and save the top 20 to a spreadsheet.
```
**Why plan**: Multi-source scraping → dedup → scoring logic → output format. Needs a clear step-by-step plan.

### 9. Full-Stack Prototype
```
Build me a bookmark manager — I want to save URLs with tags, search them, and have it auto-extract the page title and description.
```
**Why plan**: Database schema, API endpoints, URL extraction, search, UI — multiple components need planning.

### 10. Environment Setup
```
Set up this machine for Python ML development — I need conda, CUDA, PyTorch, Jupyter, and common data science libraries. Make sure everything's compatible.
```
**Why plan**: Dependency hell is real. Must plan version compatibility before installing anything.

### 11. Content Generation Pipeline
```
Write a technical blog post about how WebSocket connections work, with code examples, diagrams, and publish it to a webpage I can share.
```
**Why plan**: Research → outline → write → code examples → diagrams (mermaid/SVG) → publish. Multi-phase creative work.

### 12. Complex Git Operations
```
I have 15 commits on this branch that are a mess. Squash related ones together, write proper commit messages, and create a clean PR description.
```
**Why plan**: Needs to analyze commits, group them logically, plan the rebase, write messages. Risky without a plan.

---

## Category 3: Forces `sub_agent` (Parallel Independent Tasks)

### 13. Multi-Site Price Comparison
```
Find the current price of a Sony WH-1000XM5 on Amazon, Best Buy, and Walmart. Tell me where it's cheapest.
```
**Why sub_agent**: Three independent web searches/scrapes that should run in parallel.

### 14. Parallel Research
```
I'm choosing between Supabase, PocketBase, and Firebase for my next project. Compare their pricing, developer experience, and self-hosting options.
```
**Why sub_agent**: Three independent product research tasks → synthesis.

### 15. Multi-File Analysis
```
Look at all the config files in this project — package.json, tsconfig, .eslintrc, docker-compose, and any CI configs. Tell me what's outdated or misconfigured.
```
**Why sub_agent**: Each config file analysis is independent. Five parallel sub-agents.

### 16. Parallel API Testing
```
Test these 5 API endpoints and tell me which ones are slow or returning errors: /api/health, /api/sessions, /api/agents, /api/memory, /api/projects
```
**Why sub_agent**: Five independent HTTP calls that should run in parallel.

### 17. Multi-Source News Digest
```
Give me a summary of today's top AI news from Hacker News, TechCrunch, and The Verge.
```
**Why sub_agent**: Three independent web searches/reads → combined digest.

### 18. Competitive Pricing Research
```
I'm launching a SaaS tool for $29/mo. Find 5 competitors in the AI writing assistant space and tell me their pricing tiers.
```
**Why sub_agent**: Each competitor research is independent work that benefits from parallelization.

---

## Category 4: Forces ALL THREE (ask_user + plan + sub_agent)

### 19. Personal Dashboard
```
Build me a personal dashboard that shows my GitHub activity, the weather, my todos, and recent news in my field.
```
- **ask_user**: What's your GitHub username? Which city for weather? What field for news? Refresh frequency?
- **plan**: 4 data sources, layout, refresh strategy, artifact/publish — needs architecture
- **sub_agent**: Each data source (GitHub API, weather API, todos, news search) fetched in parallel

### 20. Investment Research
```
I'm thinking about investing in AI infrastructure companies. Research NVIDIA, AMD, and Broadcom — recent earnings, analyst sentiment, and any risks.
```
- **ask_user**: Time horizon? Risk tolerance? Current portfolio context? Want charts?
- **plan**: Research framework, output format, comparison methodology
- **sub_agent**: Each company research is independent → parallel sub-agents → synthesis

### 21. Automated Report
```
Generate a weekly report of everything I did in this project — commits, files changed, new features, bugs fixed — and format it nicely.
```
- **ask_user**: Report for which week? Include all branches? Audience (manager/team/personal)? Output format?
- **plan**: Data collection (git log, diff stats) → categorization → writing → formatting → delivery
- **sub_agent**: Git analysis, commit categorization, and formatting can be parallelized

### 22. Travel Planning
```
Plan a 5-day trip to Tokyo for me in December. I want food recommendations, must-see spots, and a day-by-day itinerary.
```
- **ask_user**: Budget? Travel style (luxury/backpacker)? Dietary restrictions? Interests (tech/culture/nature)? Hotel area preference?
- **plan**: Research → itinerary structure → daily breakdown → recommendations → output
- **sub_agent**: Food research, attractions research, logistics research, seasonal events — all parallel

### 23. Codebase Onboarding
```
I just joined this project. Explain to me how everything works — the architecture, how data flows, what each package does, and where to start if I want to add a new feature.
```
- **ask_user**: What's your experience level? Which part are you working on first? Any specific feature you'll be building?
- **plan**: Systematic exploration plan (architecture → packages → data flow → extension points)
- **sub_agent**: Each package analysis runs in parallel → synthesis into coherent guide

### 24. Content Calendar
```
Help me create a month of social media content for my developer tool. I need tweet ideas, LinkedIn posts, and blog topic suggestions.
```
- **ask_user**: What's the tool? Target audience? Tone (professional/casual/meme-y)? Any launches/events coming up?
- **plan**: Content strategy → theme weeks → platform-specific formats → calendar layout
- **sub_agent**: Twitter content, LinkedIn content, and blog topics researched/generated in parallel

---

## Category 5: Power User & Edge Cases

### 25. Real-Time Monitoring Agent
```
Create an agent that watches my server logs for errors and sends me a notification whenever something critical happens.
```
**Triggers**: ask_user (which logs? what's critical? how to notify?) + plan (agent architecture, log parsing, notification setup) + agent tool (create scheduled/persistent agent)

### 26. Database From Scratch
```
I have a spreadsheet of my personal library — 200 books with title, author, genre, rating, and date read. Import it into a searchable database and build me a way to query it.
```
**Triggers**: ask_user (where's the file? want a web UI or CLI?) + plan (schema design, import, query interface) + sub_agent (parse CSV, create schema, build query tool in parallel)

### 27. Multi-Step Debugging
```
My server keeps crashing every few hours. Help me figure out why.
```
**Triggers**: ask_user (which server? any error messages? when did it start? recent changes?) + plan (diagnostic approach) + sub_agent (check logs, check memory, check disk, check processes in parallel)

### 28. Automated Workflow
```
Every time I save a new file in my notes folder, I want Anton to auto-tag it based on content, move it to the right subfolder, and update an index file.
```
**Triggers**: ask_user (which folder? what tags exist? index format?) + plan (file watcher, content analysis, tagging logic, folder structure) + agent tool (create persistent agent)

### 29. Portfolio Site
```
Build me a developer portfolio website with my projects, skills, blog, and contact form. Make it look modern.
```
**Triggers**: ask_user (name? projects to feature? color scheme? any existing brand?) + plan (design system, pages, components, deployment) + sub_agent (design, content writing, code generation in parallel)

### 30. Competitive Analysis Report
```
I'm building a note-taking app. Research Notion, Obsidian, Roam, and Logseq — their features, pricing, what users love and hate, and where there's a gap I can fill. Give me a full report.
```
**Triggers**:
- **ask_user**: What's your app's angle? Who's your target user? Free or paid?
- **plan**: Research framework → per-product analysis → gap analysis → opportunity mapping → report structure
- **sub_agent**: 4 products researched in parallel (each reads docs, reviews, pricing) → synthesized into a report with the artifact tool

---

## Scoring Rubric

When testing, score each prompt on:

| Feature | Score 0 | Score 1 | Score 2 |
|---------|---------|---------|---------|
| **ask_user** | Guessed/assumed everything | Asked 1 question | Asked all necessary questions with good options |
| **plan** | Dove straight into execution | Mentioned a plan in text | Used the `plan` tool with proper markdown |
| **sub_agent** | Did everything sequentially | Spawned 1 sub_agent | Spawned multiple sub_agents in parallel |
| **task_tracker** | No progress tracking | Partial tracking | Full task list with status updates |
| **tool variety** | Used only 1-2 tools | Used 3-4 tools | Used 5+ appropriate tools |

**Target score per prompt**: 6+ out of 10 for Category 4 & 5 prompts.

---

## If Anton Still Doesn't Use These Features

The problem is in the system prompt. Likely fixes:

1. **Add explicit triggers**: "If the user's request has >1 valid interpretation, you MUST use ask_user"
2. **Make plan mandatory**: "If the task requires >3 tool calls, you MUST use the plan tool first"
3. **Add sub_agent examples**: Show the model what parallel sub_agent usage looks like in the prompt
4. **Add a meta-reasoning step**: "Before responding, think: should I ask, plan, or delegate?"
