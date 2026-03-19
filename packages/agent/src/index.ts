#!/usr/bin/env node

/**
 * anton.computer agent — your personal cloud computer daemon.
 *
 * Install on any VPS, connect from the desktop app.
 * The agent DOES things — deploys code, manages files, monitors servers.
 *
 * Usage:
 *   anton-agent              # Start with default config (~/.anton/config.yaml)
 *   anton-agent --port 9876  # Override port
 */

import { loadConfig } from "./config.js";
import { loadSkills } from "./skills.js";
import { AgentServer } from "./server.js";
import { Agent } from "./agent.js";
import { Scheduler } from "./scheduler.js";
import { VERSION, GIT_HASH, SPEC_VERSION } from "./version.js";

async function main() {
  console.log(`
   ┌─────────────────────────────────────┐
   │  anton.computer agent v${VERSION}         │
   │  Your personal cloud computer.      │
   │  commit: ${GIT_HASH.padEnd(28)}│
   │  spec:   ${SPEC_VERSION.padEnd(28)}│
   └─────────────────────────────────────┘
  `);

  // Load config (creates default on first run)
  const config = loadConfig();

  // Load skills from ~/.anton/skills/
  const skills = loadSkills();
  config.skills = skills;

  if (skills.length > 0) {
    console.log(`  Loaded ${skills.length} skill(s):`);
    for (const skill of skills) {
      console.log(`    - ${skill.name}: ${skill.description}`);
    }
  }

  // Start the WebSocket server (handles desktop connections)
  const server = new AgentServer(config);
  await server.start();

  // Start the scheduler for 24/7 autonomous skills
  const agent = new Agent(config);
  const scheduler = new Scheduler(agent);
  scheduler.addSkills(skills);
  scheduler.start();

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    scheduler.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
