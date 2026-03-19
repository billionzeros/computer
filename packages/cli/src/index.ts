#!/usr/bin/env node

/**
 * anton — CLI for anton.computer
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → ws://  (default)
 *   Port 9877 → wss:// (--tls)
 *
 * Usage:
 *   anton                           Interactive REPL
 *   anton connect [host]            Connect to an agent (interactive)
 *   anton machines                  List saved machines
 *   anton chat "message"            One-shot chat
 *   anton shell                     Remote shell
 *   anton skills [list|run <name>]  Manage skills
 *   anton status                    Check agent status
 *   anton help                      Show this help
 */

import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { connectCommand } from "./commands/connect.js";
import { machinesCommand } from "./commands/machines.js";
import { chatCommand } from "./commands/chat.js";
import { shellCommand } from "./commands/shell.js";
import { skillsCommand } from "./commands/skills.js";
import { statusCommand } from "./commands/status.js";
import { getDefaultMachine } from "./lib/machines.js";
import { theme, LOGO } from "./lib/theme.js";

const args = process.argv.slice(2);
const command = args[0];

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

async function main() {
  switch (command) {
    case "connect": {
      // Host is optional — will prompt interactively if not provided
      const host = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      await connectCommand({
        host,
        token: parseFlag("--token"),
        name: parseFlag("--name"),
        tls: hasFlag("--tls"),
      });
      break;
    }

    case "machines":
      machinesCommand();
      break;

    case "chat": {
      const message = args.slice(1).join(" ");
      if (!message) {
        console.log(`\n  Usage: anton chat "your message here"\n`);
        process.exit(1);
      }
      await chatCommand(message);
      break;
    }

    case "shell":
      await shellCommand();
      break;

    case "skills": {
      const action = (args[1] ?? "list") as "list" | "run";
      const skillName = args[2];
      await skillsCommand(action, skillName);
      break;
    }

    case "status":
      await statusCommand(args[1], args[2] ? parseInt(args[2], 10) : undefined);
      break;

    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;

    case "version":
    case "--version":
    case "-v":
      console.log("anton v0.1.0");
      break;

    case undefined: {
      // Interactive REPL mode
      const machine = getDefaultMachine();
      if (!machine) {
        console.log(LOGO);
        console.log(`  ${theme.warning("No machines configured.")}`);
        console.log(`  Run ${theme.bold("anton connect")} to get started.\n`);
        process.exit(0);
      }

      const { waitUntilExit } = render(React.createElement(App, { machine }));
      await waitUntilExit();
      break;
    }

    default:
      console.log(`\n  Unknown command: ${command}`);
      console.log(`  Run ${theme.bold("anton help")} for usage.\n`);
      process.exit(1);
  }
}

function showHelp() {
  console.log(LOGO);
  console.log(`  ${theme.bold("Usage:")}`);
  console.log();
  console.log(`  ${theme.brand("anton")}                              Interactive REPL`);
  console.log(`  ${theme.brand("anton connect")} [host]               Connect to an agent`);
  console.log(`    --token <tok>                     Auth token`);
  console.log(`    --name <name>                     Friendly name`);
  console.log(`    --tls                             Use TLS (port 9877)`);
  console.log(`  ${theme.brand("anton machines")}                      List saved machines`);
  console.log(`  ${theme.brand("anton chat")} "message"                One-shot chat`);
  console.log(`  ${theme.brand("anton shell")}                         Remote shell`);
  console.log(`  ${theme.brand("anton skills")} [list|run <name>]      Manage skills`);
  console.log(`  ${theme.brand("anton status")}                        Check agent status`);
  console.log(`  ${theme.brand("anton help")}                          Show this help`);
  console.log();
  console.log(`  ${theme.dim("Ports (from SPEC.md):")}`);
  console.log(`    ${theme.dim("9876")}  ws://   ${theme.dim("plain (default)")}`);
  console.log(`    ${theme.dim("9877")}  wss://  ${theme.dim("TLS (--tls flag)")}`);
  console.log();
}

main().catch((err) => {
  console.error(theme.error(`Fatal: ${err.message}`));
  process.exit(1);
});
