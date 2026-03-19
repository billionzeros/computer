/**
 * WebSocket server — the pipe between desktop app and agent.
 * Handles auth, multiplexed channels, and message routing.
 *
 * Connection spec (see /SPEC.md):
 *   Port 9876 (config.port)     → plain ws:// (primary, default)
 *   Port 9877 (config.port + 1) → wss:// with self-signed TLS
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { AgentConfig } from "./config.js";
import { getAntonDir } from "./config.js";
import { Agent } from "./agent.js";
import { VERSION, GIT_HASH, SPEC_VERSION } from "./version.js";
import { Channel, encodeFrame, decodeFrame, parseJsonPayload } from "@anton/protocol";
import type {
  ControlMessage,
  AiMessage,
  TerminalMessage,
  EventMessage,
} from "@anton/protocol";

export class AgentServer {
  private wss: WebSocketServer | null = null;
  private config: AgentConfig;
  private agent: Agent;
  private activeClient: WebSocket | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.agent = new Agent(config);

    // Wire up confirmation handler — asks desktop app for approval
    this.agent.setConfirmHandler(async (command, reason) => {
      if (!this.activeClient) return false;

      return new Promise((resolve) => {
        const confirmId = `c_${Date.now()}`;

        this.sendToClient(Channel.AI, {
          type: "confirm",
          id: confirmId,
          command,
          reason,
        });

        const timeout = setTimeout(() => resolve(false), 60_000);

        const handler = (data: Buffer) => {
          try {
            const frame = decodeFrame(new Uint8Array(data));
            if (frame.channel === Channel.AI) {
              const msg = parseJsonPayload<AiMessage>(frame.payload);
              if (msg.type === "confirm_response" && msg.id === confirmId) {
                clearTimeout(timeout);
                this.activeClient?.off("message", handler);
                resolve(msg.approved);
              }
            }
          } catch {}
        };

        this.activeClient?.on("message", handler);
      });
    });
  }

  async start(): Promise<void> {
    const { port } = this.config;
    const tlsPort = port + 1;

    // ── Primary: plain WS on config.port (default 9876) ──
    const plainServer = createHttpServer();
    const plainWss = new WebSocketServer({ server: plainServer });
    plainWss.on("connection", (ws) => this.handleConnection(ws));

    plainServer.listen(port, () => {
      console.log(`  ws://0.0.0.0:${port}  (primary, plain)`);
    });

    this.wss = plainWss;

    // ── Secondary: TLS on config.port + 1 (default 9877) ──
    const certDir = join(getAntonDir(), "certs");
    ensureCerts(certDir);

    const certPath = join(certDir, "cert.pem");
    const keyPath = join(certDir, "key.pem");

    if (existsSync(certPath) && existsSync(keyPath)) {
      try {
        const tlsServer = createHttpsServer({
          cert: readFileSync(certPath),
          key: readFileSync(keyPath),
        });
        const tlsWss = new WebSocketServer({ server: tlsServer });
        tlsWss.on("connection", (ws) => this.handleConnection(ws));

        tlsServer.listen(tlsPort, () => {
          console.log(`  wss://0.0.0.0:${tlsPort} (TLS, self-signed)`);
        });
      } catch (err: any) {
        console.error(`  TLS server failed to start: ${err.message}`);
      }
    }

    console.log(`\n  Agent ID: ${this.config.agentId}`);
    console.log(`  Token:    ${this.config.token}\n`);
  }

  private handleConnection(ws: WebSocket) {
    console.log("Client connected, waiting for auth...");

    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, "Auth timeout");
      }
    }, 10_000);

    ws.on("message", async (data: Buffer) => {
      try {
        const frame = decodeFrame(new Uint8Array(data));

        if (!authenticated) {
          if (frame.channel === Channel.CONTROL) {
            const msg = parseJsonPayload<ControlMessage>(frame.payload);
            if (msg.type === "auth" && msg.token === this.config.token) {
              authenticated = true;
              clearTimeout(authTimeout);
              this.activeClient = ws;
              this.sendToClient(Channel.CONTROL, {
                type: "auth_ok",
                agentId: this.config.agentId,
                version: VERSION,
                gitHash: GIT_HASH,
                specVersion: SPEC_VERSION,
              });
              console.log("Client authenticated");

              this.sendToClient(Channel.EVENTS, {
                type: "agent_status",
                status: "idle",
              });
            } else {
              ws.send(
                encodeFrame(Channel.CONTROL, {
                  type: "auth_error",
                  reason: "Invalid token",
                })
              );
              ws.close(4003, "Auth failed");
            }
          }
          return;
        }

        await this.handleMessage(frame.channel as any, frame.payload);
      } catch (err: any) {
        console.error("Message error:", err.message);
      }
    });

    ws.on("close", () => {
      if (ws === this.activeClient) {
        this.activeClient = null;
        console.log("Client disconnected");
      }
    });
  }

  private async handleMessage(channel: number, payload: Uint8Array) {
    switch (channel) {
      case Channel.CONTROL: {
        const msg = parseJsonPayload<ControlMessage>(payload);
        if (msg.type === "ping") {
          this.sendToClient(Channel.CONTROL, { type: "pong" });
        }
        break;
      }

      case Channel.AI: {
        const msg = parseJsonPayload<AiMessage>(payload);
        if (msg.type === "message") {
          this.sendToClient(Channel.EVENTS, {
            type: "agent_status",
            status: "working",
            detail: "Processing your request...",
          });

          for await (const event of this.agent.processMessage(msg.content, "desktop")) {
            this.sendToClient(Channel.AI, event);
          }

          this.sendToClient(Channel.EVENTS, {
            type: "agent_status",
            status: "idle",
          });
        }
        break;
      }

      case Channel.TERMINAL: {
        const msg = parseJsonPayload<TerminalMessage>(payload);
        console.log("Terminal message:", msg.type);
        break;
      }

      default:
        console.log(`Unknown channel: ${channel}`);
    }
  }

  private sendToClient(channel: number, message: object) {
    if (this.activeClient && this.activeClient.readyState === WebSocket.OPEN) {
      this.activeClient.send(encodeFrame(channel as any, message));
    }
  }
}

function ensureCerts(certDir: string) {
  const certPath = join(certDir, "cert.pem");
  const keyPath = join(certDir, "key.pem");

  if (existsSync(certPath) && existsSync(keyPath)) return;

  console.log("Generating self-signed TLS certificate...");

  try {
    execSync(`mkdir -p "${certDir}"`);
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
        `-days 365 -nodes -subj "/CN=anton.computer"`,
      { stdio: "pipe" }
    );
  } catch (err: any) {
    console.error("Failed to generate certs:", err.message);
  }
}
