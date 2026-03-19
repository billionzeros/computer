// ── Control Channel (0x00) ──────────────────────────────────────────

export interface AuthMessage {
  type: "auth";
  token: string;
}

export interface AuthOkMessage {
  type: "auth_ok";
  agentId: string;
  version: string;
  gitHash: string;
  specVersion: string;
}

export interface AuthErrorMessage {
  type: "auth_error";
  reason: string;
}

export interface PingMessage {
  type: "ping";
}

export interface PongMessage {
  type: "pong";
}

export type ControlMessage =
  | AuthMessage
  | AuthOkMessage
  | AuthErrorMessage
  | PingMessage
  | PongMessage;

// ── Terminal Channel (0x01) ─────────────────────────────────────────

export interface PtySpawnMessage {
  type: "pty_spawn";
  id: string;
  cols: number;
  rows: number;
  shell?: string;
}

export interface PtyResizeMessage {
  type: "pty_resize";
  id: string;
  cols: number;
  rows: number;
}

export interface PtyCloseMessage {
  type: "pty_close";
  id: string;
}

export interface PtyDataMessage {
  type: "pty_data";
  id: string;
  data: string; // base64 for binary safety over JSON
}

export type TerminalMessage =
  | PtySpawnMessage
  | PtyResizeMessage
  | PtyCloseMessage
  | PtyDataMessage;

// ── AI Channel (0x02) ───────────────────────────────────────────────

export interface AiUserMessage {
  type: "message";
  content: string;
}

export interface AiThinkingMessage {
  type: "thinking";
  text: string;
}

export interface AiTextMessage {
  type: "text";
  content: string;
}

export interface AiToolCallMessage {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AiToolResultMessage {
  type: "tool_result";
  id: string;
  output: string;
  isError?: boolean;
}

export interface AiConfirmMessage {
  type: "confirm";
  id: string;
  command: string;
  reason: string;
}

export interface AiConfirmResponseMessage {
  type: "confirm_response";
  id: string;
  approved: boolean;
}

export interface AiDoneMessage {
  type: "done";
}

export interface AiErrorMessage {
  type: "error";
  message: string;
}

export type AiMessage =
  | AiUserMessage
  | AiThinkingMessage
  | AiTextMessage
  | AiToolCallMessage
  | AiToolResultMessage
  | AiConfirmMessage
  | AiConfirmResponseMessage
  | AiDoneMessage
  | AiErrorMessage;

// ── Event Channel (0x04) ────────────────────────────────────────────

export interface FileChangedEvent {
  type: "file_changed";
  path: string;
  change: "created" | "modified" | "deleted" | "renamed";
}

export interface PortChangedEvent {
  type: "port_changed";
  port: number;
  status: "opened" | "closed";
  process?: string;
}

export interface TaskCompletedEvent {
  type: "task_completed";
  summary: string;
}

export interface AgentStatusEvent {
  type: "agent_status";
  status: "idle" | "working" | "error";
  detail?: string;
}

export type EventMessage =
  | FileChangedEvent
  | PortChangedEvent
  | TaskCompletedEvent
  | AgentStatusEvent;
