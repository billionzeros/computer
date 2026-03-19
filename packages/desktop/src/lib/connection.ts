/**
 * WebSocket connection manager for Tauri desktop app.
 * Handles connecting to the agent, auth handshake, multiplexed pipes,
 * and reconnection.
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → plain ws:// (primary, default)
 *   Port 9877 → wss:// when "Use TLS" is checked
 */

import { Channel } from "@anton/protocol";
import type {
  ControlMessage,
  AiMessage,
  TerminalMessage,
  EventMessage,
  AgentStatusEvent,
} from "@anton/protocol";

// We inline the codec here to avoid Uint8Array issues in browser context
function encodeFrame(channel: number, payload: object): ArrayBuffer {
  const json = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(json);
  const frame = new Uint8Array(1 + payloadBytes.length);
  frame[0] = channel;
  frame.set(payloadBytes, 1);
  return frame.buffer;
}

function decodeFrame(data: ArrayBuffer): { channel: number; payload: any } {
  const bytes = new Uint8Array(data);
  const channel = bytes[0];
  const payloadBytes = bytes.slice(1);
  const text = new TextDecoder().decode(payloadBytes);
  return { channel, payload: JSON.parse(text) };
}

export type ConnectionStatus = "disconnected" | "connecting" | "authenticating" | "connected" | "error";

export interface ConnectionConfig {
  host: string;        // IP or hostname
  port: number;        // default 9876
  token: string;       // auth token from agent install
  useTLS: boolean;     // wss:// vs ws://
}

export type MessageHandler = (channel: number, message: any) => void;

export class Connection {
  private ws: WebSocket | null = null;
  private config: ConnectionConfig | null = null;
  private handlers: MessageHandler[] = [];
  private statusListeners: ((status: ConnectionStatus, detail?: string) => void)[] = [];
  private _status: ConnectionStatus = "disconnected";
  private reconnectTimer: number | null = null;
  private agentId: string = "";
  private agentVersion: string = "";

  get status() { return this._status; }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  onStatusChange(listener: (status: ConnectionStatus, detail?: string) => void) {
    this.statusListeners.push(listener);
    return () => { this.statusListeners = this.statusListeners.filter(l => l !== listener); };
  }

  connect(config: ConnectionConfig) {
    this.config = config;
    this.doConnect();
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "User disconnect");
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  send(channel: number, message: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeFrame(channel, message));
  }

  sendAiMessage(content: string) {
    this.send(Channel.AI, { type: "message", content });
  }

  sendTerminalData(sessionId: string, data: string) {
    this.send(Channel.TERMINAL, { type: "pty_data", id: sessionId, data });
  }

  sendTerminalSpawn(sessionId: string, cols: number, rows: number) {
    this.send(Channel.TERMINAL, { type: "pty_spawn", id: sessionId, cols, rows });
  }

  sendTerminalResize(sessionId: string, cols: number, rows: number) {
    this.send(Channel.TERMINAL, { type: "pty_resize", id: sessionId, cols, rows });
  }

  sendConfirmResponse(id: string, approved: boolean) {
    this.send(Channel.AI, { type: "confirm_response", id, approved });
  }

  private doConnect() {
    if (!this.config) return;
    const { host, port, token, useTLS } = this.config;

    this.setStatus("connecting");

    const protocol = useTLS ? "wss" : "ws";
    const url = `${protocol}://${host}:${port}`;

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";
    } catch (err: any) {
      this.setStatus("error", err.message);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.setStatus("authenticating");
      this.send(Channel.CONTROL, { type: "auth", token });
    };

    this.ws.onmessage = (event) => {
      try {
        const { channel, payload } = decodeFrame(event.data);

        // Handle auth response
        if (channel === Channel.CONTROL && payload.type === "auth_ok") {
          this.agentId = payload.agentId;
          this.agentVersion = payload.version;
          this.setStatus("connected", `Agent: ${this.agentId}`);
        } else if (channel === Channel.CONTROL && payload.type === "auth_error") {
          this.setStatus("error", `Auth failed: ${payload.reason}`);
          this.ws?.close();
          return;
        }

        // Dispatch to handlers
        for (const handler of this.handlers) {
          handler(channel, payload);
        }
      } catch (err) {
        console.error("Failed to decode message:", err);
      }
    };

    this.ws.onclose = (event) => {
      if (this._status === "connected") {
        this.setStatus("disconnected", "Connection lost");
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.setStatus("error", "Connection failed");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.config && this._status !== "connected") {
        console.log("Reconnecting...");
        this.doConnect();
      }
    }, 3000);
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status, detail);
    }
  }
}

// Singleton connection instance
export const connection = new Connection();
