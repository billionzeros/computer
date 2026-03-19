/**
 * `anton connect [host]` — interactive connect flow.
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → plain ws:// (default)
 *   Port 9877 → wss:// (with --tls)
 */

import { createInterface } from "node:readline";
import { Connection } from "../lib/connection.js";
import { saveMachine, loadMachines } from "../lib/machines.js";
import { theme, ICONS, LOGO } from "../lib/theme.js";

/** Spec-defined ports — single source of truth */
const PORT_PLAIN = 9876;
const PORT_TLS = 9877;

interface ConnectArgs {
  host?: string;
  token?: string;
  name?: string;
  tls: boolean;
}

export async function connectCommand(args: ConnectArgs): Promise<void> {
  let { host, token, name, tls } = args;

  console.log();
  console.log(`  ${theme.brandBold("anton.computer")} ${theme.dim("— connect to your agent")}`);
  console.log();

  // Step 1: Host
  if (!host) {
    host = await promptInput(`  ${theme.label("Host")} ${theme.dim("(IP or domain)")}: `);
    if (!host) {
      console.log(`  ${ICONS.toolError} ${theme.error("Host is required.")}`);
      process.exit(1);
    }
  } else {
    console.log(`  ${theme.label("Host")}:  ${host}`);
  }

  // Step 2: Token
  if (!token) {
    token = await promptInput(`  ${theme.label("Token")}: `);
    if (!token) {
      console.log(`  ${ICONS.toolError} ${theme.error("Token is required.")}`);
      process.exit(1);
    }
  }

  // Step 3: Name
  if (!name) {
    name = await promptInput(`  ${theme.label("Name")} ${theme.dim(`(default: ${host})`)}: `);
    if (!name) name = host;
  }

  // Derive port from TLS flag per spec
  const port = tls ? PORT_TLS : PORT_PLAIN;
  const proto = tls ? "wss" : "ws";

  console.log();
  console.log(`  ${ICONS.connecting} Connecting to ${theme.bold(`${proto}://${host}:${port}`)}...`);

  const conn = new Connection();

  try {
    await conn.connect({ host, port, token, useTLS: tls });

    console.log(`  ${ICONS.connected} ${theme.success("Connected!")}`);
    console.log();
    console.log(`  ${theme.dim("Agent ID")}:  ${conn.agentId}`);
    console.log(`  ${theme.dim("Version")}:   v${conn.agentVersion}`);
    console.log(`  ${theme.dim("Protocol")}:  ${proto}://${host}:${port}`);

    // Save machine
    const isFirst = loadMachines().length === 0;
    saveMachine({
      name: name!,
      host,
      port,
      token,
      useTLS: tls,
      default: isFirst,
    });

    console.log();
    console.log(`  ${ICONS.toolDone} Saved as ${theme.bold(`"${name}"`)}${isFirst ? theme.dim(" (default)") : ""}`);
    console.log(`  ${theme.dim("Run")} ${theme.bold("anton")} ${theme.dim("to start chatting.")}`);
    console.log();

    conn.disconnect();
  } catch (err: any) {
    console.log(`  ${ICONS.disconnected} ${theme.error("Connection failed")}`);
    console.log(`  ${theme.dim(err.message)}`);
    console.log();
    console.log(`  ${theme.dim("Troubleshooting:")}`);
    console.log(`    ${theme.dim("• Is the agent running?")} ${theme.muted("ssh into your VPS and check")}`);
    console.log(`    ${theme.dim("• Is port")} ${theme.bold(String(port))} ${theme.dim("open in your firewall/security group?")}`);
    if (!tls) {
      console.log(`    ${theme.dim("• Try with TLS:")} ${theme.bold("anton connect --tls")}`);
    }
    console.log();
    process.exit(1);
  }
}

function promptInput(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
