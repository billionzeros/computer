# Production Audit — Anton Computer

Date: 2026-03-31
Overall readiness: **6/10** — runs, but has real gaps before shipping widely.

---

## CRITICAL — Fix before shipping

### 1. Shell injection in database + network tools
- **database.ts**: SQL passed to sqlite3 CLI with only `"` escaping. `.schema ${table}` is unquoted.
- **network.ts**: Header values and body params have fragile escaping in shell commands.
- **Fix**: Use Node.js native sqlite3 library + native fetch. Stop shelling out for these.

### 2. `forbiddenPaths` is defined but never enforced
- **filesystem.ts** never checks `config.security.forbiddenPaths` before read/write.
- Agent can read `~/.ssh/id_rsa`, `/etc/shadow`, etc.
- **Fix**: Add path validation in filesystem tool against forbidden patterns.

### 3. `confirmPatterns` only checked for shell
- Database DDL (DROP TABLE), filesystem deletes, network scans all bypass confirmation.
- **Fix**: Apply confirmation check to filesystem writes, database DDL, network operations.

### 4. Browser tool — global singleton, never cleaned up
- Single `let session: BrowserSession | null` shared across all sessions. No cleanup on session end. No timeout.
- **Fix**: Per-session browser management, auto-close after N minutes idle, cleanup on session destroy.

### 5. No rate limiting on WebSocket server
- A single client can spam unlimited messages, create unlimited sessions.
- **Fix**: Per-client message rate limiting, connection resource budgets.

### 6. MCP servers orphaned on shutdown
- `shutdown()` doesn't call `mcpManager.stopAll()`. MCP child processes survive server restart.
- **Fix**: Add MCP cleanup to shutdown handler.

---

## HIGH — Fix soon after shipping

### 7. Zero test coverage
- No test files, no test framework configured, no CI checks.
- **Fix**: Set up vitest. Start with: shell escaping, path traversal prevention, compaction edge cases, scorer correctness.

### 8. Compaction can lose context if LLM summary fails
- If `completeSimple()` throws, messages are discarded but no summary is stored.
- **Fix**: On LLM failure, skip compaction. Keep original messages. Retry next turn.

### 9. No structured logging
- All `console.log` with ad-hoc prefixes. No levels, no timestamps, no JSON output.
- **Fix**: Use pino or similar. Structured JSON logs with correlation IDs.

### 10. Config validation incomplete
- Invalid YAML, missing providers, bad regex patterns accepted silently.
- **Fix**: Validate schema at load time. Fail fast on bad config.

### 11. Session TTL cleanup only runs at startup
- Old sessions accumulate on disk indefinitely after server has been running for days.
- **Fix**: Schedule periodic cleanup (hourly).

### 12. No SSRF protection
- `http_api` and `network` tools can hit localhost/internal IPs.
- **Fix**: Block private/internal IP ranges in HTTP tools.

---

## Braintrust Integration — Specific gaps

### 13. Trace span not in finally block (HIGH)
- If `processMessage()` throws before span closing, the Braintrust span stays open forever.
- **Fix**: Move span.end() into a finally block. Ensure orphaned tool spans are always cleaned up.

### 14. `toolCallCount` metric is wrong
- Counts unique tool NAMES, not actual tool calls. If `shell` is called 5 times with 1 error, success rate shows 0% instead of 80%.
- **Fix**: Track actual call count, not `usedToolNames.size`.

### 15. Eval CLI exits 0 on failure
- If all suites fail, process exits with code 0. CI can't detect failure.
- **Fix**: Track failures, `process.exit(1)` if any suite failed.

### 16. Model pricing incomplete
- Missing older Claude models (3.5 Sonnet, Opus 3.5). No "last updated" timestamp.
- **Fix**: Add missing models, add pricing source comments.

### 17. Safety scorer too permissive
- "I cannot verify this, let me run it anyway" matches "cannot" and scores as refusal.
- **Fix**: Check for negation follow-ups ("but", "anyway", "however").

### 18. Factuality keyword scorer filters short words
- `filter(w.length > 3)` drops "npm", "git", "sql", "api" — critical tech terms.
- **Fix**: Lower to `w.length > 2`.

### 19. Eval datasets need more coverage
Missing: MCP tool tests, path traversal attacks, SQL injection, multi-tool workflows, error scenarios.

### 20. Evals not exported from index.ts
External packages can't import eval types/datasets/scorers through the public API.

### 21. No timeout wrapper on eval cases
If LLM hangs, eval case runs indefinitely. `maxDurationMs: 60s` only limits per-turn.

### 22. Sample rate not validated
`sampleRate: 5` would score 100% of sessions. No [0,1] range check.

---

## Making Anton BETTER (product quality)

### 23. Request tracing / correlation IDs
- No trace ID propagation from WebSocket connection → session → tool → LLM call.
- Makes production debugging extremely painful. Add trace ID at connection, propagate through all layers.

### 24. Session cancellation doesn't abort in-flight calls
- `session.cancel()` stops the agent but in-flight HTTP/MCP calls continue burning tokens.
- **Fix**: Propagate AbortSignal through tool execution chain.

### 25. MCP health checking
- Dead MCP servers stay "connected" until a tool call fails.
- **Fix**: Periodic ping (every 30s), reconnect on failure.

### 26. Sub-agent resource isolation
- Sub-agents share the same browser instance, file system, everything.
- Consider: per-sub-agent tmp directory, separate browser contexts, isolated memory.

### 27. Token budget awareness in system prompt
- System prompt can be 10K+ tokens but there's no feedback to the user about prompt cost.
- Show prompt cost breakdown in debug mode.

### 28. Smarter compaction
- Current: threshold-based (80% of context). No awareness of what's important.
- Better: weight recent tool results higher, preserve user instructions, compress repetitive outputs.

### 29. User feedback loop
- No mechanism for users to rate agent responses (thumbs up/down).
- This is the #1 signal for improving quality. Feed into Braintrust as scores.

### 30. Connector error recovery
- When an OAuth token expires mid-session, the tool fails with a cryptic error.
- Better: detect token expiry, prompt for re-auth, retry the call.

---

## Priority execution order

```
Week 1: Security (items 1-3, 12)
Week 2: Resource cleanup (items 4, 6, 11)
Week 3: Braintrust fixes (items 13-15, 21-22)
Week 4: Testing + CI (item 7)
Week 5: Logging + config validation (items 9-10)
Week 6: Rate limiting + auth hardening (item 5)
Week 7: Product quality (items 23, 29, 30)
```
