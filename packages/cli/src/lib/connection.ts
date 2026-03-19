/**
 * WebSocket connection manager for Node.js CLI.
 * Same protocol as desktop but using `ws` package.
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → plain ws:// (primary, default)
 *   Port 9877 → wss:// with --tls flag
 */

import WebSocket from "ws";
import { Channel, encodeFrame, decodeFrame, parseJsonPayload } from "@anton/protocol";
import type { ControlMessage, AiMessage, TerminalMessage, EventMessage } from "@anton/protocol";

export type ConnectionStatus = "disconnected" | "connecting" | "authenticating" | "connected" | "error";

export interface ConnectionConfig {
  host: string;
  port: number;
  token: string;
  useTLS: boolean;
}

export type MessageHandler = (channel: number, message: any) => void;
export type StatusListener = (status: ConnectionStatus, detail?: string) => void;

export class Connection {
  private ws: WebSocket | null = null;
  private config: ConnectionConfig | null = null;
  private handlers: MessageHandler[] = [];
  private statusListeners: StatusListener[] = [];
  private _status: ConnectionStatus = "disconnected";
  private _agentId = "";
  private _agentVersion = "";

  get status() { return this._status; }
  get agentId() { return this._agentId; }
  get agentVersion() { return this._agentVersion; }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  onStatusChange(listener: StatusListener) {
    this.statusListeners.push(listener);
    return () => { this.statusListeners = this.statusListeners.filter(l => l !== listener); };
  }

  connect(config: ConnectionConfig): Promise<void> {
    this.config = config;
    return new Promise((resolve, reject) => {
      const { host, port, token, useTLS } = config;

      this.setStatus("connecting");

      const protocol = useTLS ? "wss" : "ws";
      const url = `${protocol}://${host}:${port}`;

      try {
        this.ws = new WebSocket(url, {
          rejectUnauthorized: false, // self-signed certs
        });
      } catch (err: any) {
        this.setStatus("error", err.message);
        reject(err);
        return;
      }

      this.ws.on("open", () => {
        this.setStatus("authenticating");
        this.send(Channel.CONTROL, { type: "auth", token });
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const frame = decodeFrame(new Uint8Array(data));
          const payload = parseJsonPayload<any>(frame.payload);

          // Handle auth response
          if (frame.channel === Channel.CONTROL && payload.type === "auth_ok") {
            this._agentId = payload.agentId;
            this._agentVersion = payload.version;
            this.setStatus("connected", `Agent: ${this._agentId}`);
            resolve();
          } else if (frame.channel === Channel.CONTROL && payload.type === "auth_error") {
            this.setStatus("error", `Auth failed: ${payload.reason}`);
            this.ws?.close();
            reject(new Error(`Auth failed: ${payload.reason}`));
            return;
          }

          // Dispatch to handlers
          for (const handler of this.handlers) {
            handler(frame.channel, payload);
          }
        } catch (err) {
          // ignore decode errors
        }
      });

      this.ws.on("close", () => {
        if (this._status === "connected") {
          this.setStatus("disconnected", "Connection lost");
        }
      });

      this.ws.on("error", (err) => {
        this.setStatus("error", err.message);
        reject(err);
      });
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, "User disconnect");
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  send(channel: number, message: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeFrame(channel as any, message));
  }

  sendAiMessage(content: string) {
    this.send(Channel.AI, { type: "message", content });
  }

  sendConfirmResponse(id: string, approved: boolean) {
    this.send(Channel.AI, { type: "confirm_response", id, approved });
  }

  sendTerminalSpawn(id: string, cols: number, rows: number) {
    this.send(Channel.TERMINAL, { type: "pty_spawn", id, cols, rows });
  }

  sendTerminalData(id: string, data: string) {
    this.send(Channel.TERMINAL, { type: "pty_data", id, data });
  }

  sendTerminalResize(id: string, cols: number, rows: number) {
    this.send(Channel.TERMINAL, { type: "pty_resize", id, cols, rows });
  }

  sendPing() {
    this.send(Channel.CONTROL, { type: "ping" });
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status, detail);
    }
  }
}
