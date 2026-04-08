/**
 * Slack connector tools — direct API, no MCP subprocess.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { type Static, type TSchema, Type } from '@sinclair/typebox'
import type { SlackAPI } from './api.js'

function toolResult(output: string, isError = false) {
  const content = [{ type: 'text' as const, text: output }]
  return { content, details: { raw: output, isError } }
}

function defineTool<T extends TSchema>(
  def: Omit<AgentTool<T>, 'execute'> & {
    execute: (
      toolCallId: string,
      params: Static<T>,
      signal?: AbortSignal,
    ) => Promise<AgentToolResult<unknown>>
  },
): AgentTool {
  return def as AgentTool
}

export interface SlackToolsOptions {
  /**
   * Which token type backs this connector.
   * - `user` (xoxp): full read/write surface including search.messages.
   * - `bot`  (xoxb): everything except search.* (Slack rejects bot tokens
   *   for those endpoints with `not_allowed_token_type`).
   */
  mode: 'user' | 'bot'
}

export function createSlackTools(api: SlackAPI, opts: SlackToolsOptions): AgentTool[] {
  const all: AgentTool[] = [
    defineTool({
      name: 'slack_list_channels',
      label: 'List Channels',
      description:
        '[Slack] List channels in the workspace. Returns channel names, topics, and member counts.',
      parameters: Type.Object({
        types: Type.Optional(
          Type.String({
            description: 'Channel types to include. Default: public_channel,private_channel',
          }),
        ),
        limit: Type.Optional(Type.Number({ description: 'Max channels to return (default: 100)' })),
      }),
      async execute(_id, params) {
        try {
          const result = await api.listChannels({
            types: params.types,
            limit: params.limit,
          })
          const channels = result.channels.map((c) => ({
            id: c.id,
            name: c.name,
            private: c.is_private,
            topic: c.topic.value,
            purpose: c.purpose.value,
            members: c.num_members,
          }))
          return toolResult(JSON.stringify(channels, null, 2))
        } catch (err) {
          return toolResult(`Error listing channels: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_send_message',
      label: 'Send Message',
      description: '[Slack] Send a message to a Slack channel or thread.',
      parameters: Type.Object({
        channel: Type.String({ description: 'Channel ID or name (e.g., #general or C1234567890)' }),
        text: Type.String({ description: 'Message text (supports Slack markdown)' }),
        thread_ts: Type.Optional(
          Type.String({ description: 'Thread timestamp to reply in a thread' }),
        ),
      }),
      async execute(_id, params) {
        try {
          const result = await api.postMessage(params.channel, params.text, {
            thread_ts: params.thread_ts,
          })
          return toolResult(`Message sent to ${result.channel} (ts: ${result.ts})`)
        } catch (err) {
          return toolResult(`Error sending message: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_get_history',
      label: 'Get Channel History',
      description: '[Slack] Get recent messages from a channel.',
      parameters: Type.Object({
        channel: Type.String({ description: 'Channel ID' }),
        limit: Type.Optional(Type.Number({ description: 'Number of messages (default: 20)' })),
      }),
      async execute(_id, params) {
        try {
          const result = await api.getHistory(params.channel, {
            limit: params.limit,
          })
          const messages = result.messages.map((m) => ({
            user: m.user,
            text: m.text,
            ts: m.ts,
            thread_ts: m.thread_ts,
            reply_count: m.reply_count,
          }))
          return toolResult(JSON.stringify(messages, null, 2))
        } catch (err) {
          return toolResult(`Error getting history: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_get_thread',
      label: 'Get Thread Replies',
      description: '[Slack] Get replies in a message thread.',
      parameters: Type.Object({
        channel: Type.String({ description: 'Channel ID' }),
        thread_ts: Type.String({ description: 'Thread timestamp of the parent message' }),
        limit: Type.Optional(Type.Number({ description: 'Max replies (default: 50)' })),
      }),
      async execute(_id, params) {
        try {
          const result = await api.getReplies(params.channel, params.thread_ts, {
            limit: params.limit,
          })
          const messages = result.messages.map((m) => ({
            user: m.user,
            text: m.text,
            ts: m.ts,
          }))
          return toolResult(JSON.stringify(messages, null, 2))
        } catch (err) {
          return toolResult(`Error getting thread: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_list_users',
      label: 'List Users',
      description: '[Slack] List workspace members.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: 'Max users to return (default: 100)' })),
      }),
      async execute(_id, params) {
        try {
          const result = await api.listUsers({ limit: params.limit })
          const users = result.members
            .filter((m) => !m.deleted && !m.is_bot)
            .map((m) => ({
              id: m.id,
              name: m.name,
              real_name: m.real_name,
              display_name: m.profile.display_name,
              email: m.profile.email,
            }))
          return toolResult(JSON.stringify(users, null, 2))
        } catch (err) {
          return toolResult(`Error listing users: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_search',
      label: 'Search Messages',
      description: '[Slack] Search for messages across the workspace.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query' }),
        count: Type.Optional(Type.Number({ description: 'Max results (default: 20)' })),
      }),
      async execute(_id, params) {
        try {
          const result = await api.searchMessages(params.query, {
            count: params.count,
          })
          const matches = result.messages.matches.map((m) => ({
            channel: m.channel.name,
            user: m.username,
            text: m.text,
            ts: m.ts,
            permalink: m.permalink,
          }))
          return toolResult(
            `Found ${result.messages.total} results:\n${JSON.stringify(matches, null, 2)}`,
          )
        } catch (err) {
          return toolResult(`Error searching: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_add_reaction',
      label: 'Add Reaction',
      description: '[Slack] Add an emoji reaction to a message.',
      parameters: Type.Object({
        channel: Type.String({ description: 'Channel ID' }),
        timestamp: Type.String({ description: 'Message timestamp' }),
        emoji: Type.String({ description: 'Emoji name without colons (e.g., thumbsup)' }),
      }),
      async execute(_id, params) {
        try {
          await api.addReaction(params.channel, params.timestamp, params.emoji)
          return toolResult(`Reaction :${params.emoji}: added`)
        } catch (err) {
          return toolResult(`Error adding reaction: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── New tools added in the bot tool surface pass ──────────────────
    // These four wrap Slack endpoints that the bot needs but didn't have
    // a tool for previously. None require new OAuth scopes — chat:write,
    // users:read, channels:read, groups:read are all already requested.

    defineTool({
      name: 'slack_edit_message',
      label: 'Edit Message',
      description:
        '[Slack] Edit a message you previously posted. Use to turn ' +
        '"looking into this..." placeholders into the real answer in ' +
        'a single bubble. Bots can only edit their own messages.',
      parameters: Type.Object({
        channel: Type.String({ description: 'Channel ID where the message lives' }),
        ts: Type.String({ description: 'Timestamp of the message to edit' }),
        text: Type.String({ description: 'New message text (Slack mrkdwn supported)' }),
      }),
      async execute(_id, params) {
        try {
          const result = await api.updateMessage(params.channel, params.ts, params.text)
          return toolResult(`Message ${result.ts} updated in ${result.channel}`)
        } catch (err) {
          return toolResult(`Error editing message: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_lookup_user',
      label: 'Look Up User',
      description:
        '[Slack] Resolve a single Slack user id (e.g. U02V7RLA64C) to ' +
        "their display name, real name, and email. Use when you've " +
        'been given a user id and need to address the human by name, ' +
        'or when @-mentioning by id is not enough. Cheaper than ' +
        'list_users when you already have the id.',
      parameters: Type.Object({
        user_id: Type.String({ description: 'Slack user id, e.g. U02V7RLA64C' }),
      }),
      async execute(_id, params) {
        try {
          const result = await api.getUserInfo(params.user_id)
          return toolResult(
            JSON.stringify(
              {
                id: result.user.id,
                name: result.user.name,
                real_name: result.user.real_name,
                display_name: result.user.profile.display_name,
                email: result.user.profile.email,
                status: result.user.profile.status_text,
              },
              null,
              2,
            ),
          )
        } catch (err) {
          return toolResult(`Error looking up user: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_get_channel_info',
      label: 'Get Channel Info',
      description:
        '[Slack] Get details about a single channel by id: name, ' +
        'topic, purpose, privacy, member count. Use when you need to ' +
        'know what channel you are in (the surface prompt has the id ' +
        'but not always the human name) or when you want to read the ' +
        'channel topic before posting.',
      parameters: Type.Object({
        channel: Type.String({ description: 'Channel id, e.g. C0AQZ5B419V' }),
      }),
      async execute(_id, params) {
        try {
          const result = await api.getChannelInfo(params.channel)
          return toolResult(
            JSON.stringify(
              {
                id: result.channel.id,
                name: result.channel.name,
                private: result.channel.is_private,
                is_dm: result.channel.is_im,
                is_group_dm: result.channel.is_mpim,
                topic: result.channel.topic?.value,
                purpose: result.channel.purpose?.value,
                members: result.channel.num_members,
              },
              null,
              2,
            ),
          )
        } catch (err) {
          return toolResult(`Error getting channel info: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'slack_get_permalink',
      label: 'Get Message Permalink',
      description:
        '[Slack] Resolve a permanent URL for a specific message. Use ' +
        'when you want to reference a previous message by link instead ' +
        'of pasting its raw text — much better for cross-thread or ' +
        'cross-channel citations.',
      parameters: Type.Object({
        channel: Type.String({ description: 'Channel id where the message lives' }),
        message_ts: Type.String({ description: 'Timestamp of the message to link to' }),
      }),
      async execute(_id, params) {
        try {
          const result = await api.getPermalink(params.channel, params.message_ts)
          return toolResult(result.permalink)
        } catch (err) {
          return toolResult(`Error getting permalink: ${(err as Error).message}`, true)
        }
      },
    }),
  ]

  if (opts.mode === 'user') return all

  // Bot mode:
  //   1. Strip `slack_search` — bot tokens (xoxb) get `not_allowed_token_type`
  //      from search.* endpoints, so the tool can never succeed.
  //   2. Rename the surviving tools from `slack_*` to `slack_bot_*`.
  //      Both the user and bot connectors are often active simultaneously
  //      (personal delegate + workspace Anton) and share the same tool bodies,
  //      but the agent must see them as DISTINCT tools so that
  //      `ConnectorManager.getAllTools` doesn't return duplicate names and
  //      `getToolPermission` doesn't leak permissions across connectors
  //      (it resolves by scanning connector tool lists for a name match).
  //      Keeping the names distinct at construction time is cheaper and less
  //      error-prone than disambiguating downstream.
  return all
    .filter((t) => t.name !== 'slack_search')
    .map((t) => ({
      ...t,
      name: t.name.replace(/^slack_/, 'slack_bot_'),
      label: `Bot: ${t.label}`,
    }))
}
