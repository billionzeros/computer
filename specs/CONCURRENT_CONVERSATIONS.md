# Concurrent Conversations

## Overview

Anton Computer supports multiple independent conversations running simultaneously. Each conversation maps to a server-side Session with its own LLM context, tool state, and history. Users can switch between conversations while background sessions continue processing.

## Architecture

### Server (`agent-server`)

```
AntonServer
  sessions: Map<string, Session>    // All active sessions
  activeTurns: Set<string>          // Sessions currently processing a turn
  activeClient: WebSocket           // Single desktop client connection
```

- Each conversation creates a separate `Session` object via `session_create`
- Sessions are stored in a `Map` keyed by session ID (e.g., `sess_m7abc123`)
- Multiple sessions can process turns concurrently (`activeTurns` is a Set)
- All events from a session include `sessionId` so the client can route them

### Client (`desktop`)

```
Store
  conversations: Conversation[]              // All conversations (localStorage)
  activeConversationId: string               // Currently viewed conversation
  sessionStatuses: Map<string, {status, detail}>  // Per-session working state
  pendingConfirm: {id, command, reason, sessionId?}  // Awaiting user approval
  pendingAskUser: {id, questions, sessionId?}         // Awaiting user input
```

- Conversations are stored in localStorage with a `sessionId` linking to the server
- Messages from background sessions are routed to the correct conversation via `sessionId`
- Status is tracked per-session so the sidebar shows which conversations are active

## Session Lifecycle

```
1. User clicks "New Thread"
   Client: newConversation(title, sessionId) -> saves to localStorage
   Client: sendSessionCreate(sessionId, {provider, model}) -> WebSocket

2. Server creates session
   Server: createSession(id, config) -> stores in sessions Map
   Server: sends session_created {id, provider, model}

3. User sends message
   Client: sendAiMessageToSession(text, sessionId)
   Server: activeTurns.add(sessionId)
   Server: session.processMessage(text) -> yields events with sessionId

4. Events stream back
   Server: sendToClient(Channel.AI, {...event, sessionId})
   Server: sendToClient(Channel.EVENTS, {type: 'agent_status', status: 'working', sessionId})
   Client: routes to correct conversation via sessionId

5. Turn completes
   Server: activeTurns.delete(sessionId)
   Server: sends agent_status {status: 'idle', sessionId}
   Client: updates sessionStatuses Map
```

## Message Routing

All AI channel messages include an optional `sessionId`. The client routes them:

- **Active session**: Updates are applied to the visible conversation (text appended, messages added)
- **Background session**: Updates go to `addMessageToSession(sessionId, msg)` which finds the matching conversation by sessionId and updates it without affecting the active view
- **Per-session assistant tracking**: `_sessionAssistantMsgIds` Map ensures text chunks for different sessions don't get mixed

## Sidebar Status Indicators

Each conversation in the sidebar shows its current state:

| State | Indicator | Trigger |
|-------|-----------|---------|
| Idle | None | Default / after `agent_status: idle` |
| Working | Spinning loader icon | `agent_status: working` for that sessionId |
| Needs Input | "Needs input" badge | `pendingConfirm`, `pendingAskUser`, or `pendingPlan` with matching sessionId |

The `sessionStatuses` Map tracks per-session status from `agent_status` events. Pending states (`pendingConfirm`, `pendingAskUser`, `pendingPlan`) include `sessionId` to identify which conversation needs attention.

## Confirm / Ask-User Isolation

When a session needs user approval (tool confirm, ask_user questions, plan review):

1. Server sends the message with `sessionId` attached
2. Client stores it with `sessionId` in `pendingConfirm` / `pendingAskUser` / `pendingPlan`
3. AgentChat only displays the dialog if it belongs to the active conversation's session
4. The sidebar shows "Needs input" on conversations awaiting approval regardless of which is active

## Session Persistence

- Sessions persist to disk at `~/.anton/conversations/{sessionId}/`
- Each session directory contains: `meta.json`, `messages.jsonl`, `images/`, `workspace/`, `memory/`
- On disconnect, all active turns are cancelled and persisted
- On reconnect, sessions can be resumed via `session_resume`

## Deletion

```
Client: sendSessionDestroy(sessionId)
Server: sessions.delete(id) + rmSync(sessionDir) + removeFromIndex
Server: sends session_destroyed {id}
Client: filters session from sessions list
```

## Limitations

- Single WebSocket connection shared by all sessions
- `pendingConfirm` / `pendingAskUser` are still global singletons (only one dialog at a time across all sessions). If two sessions need approval simultaneously, the second overwrites the first
- Title generation depends on the LLM provider being configured correctly
