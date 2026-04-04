import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { type Static, type TSchema, Type } from '@sinclair/typebox'
import type { UnipileLinkedInAPI } from './api.js'

function toolResult(output: string, isError = false) {
  return { content: [{ type: 'text' as const, text: output }], details: { raw: output, isError } }
}

function defineTool<T extends TSchema>(
  def: Omit<AgentTool<T>, 'execute'> & {
    execute: (
      id: string,
      params: Static<T>,
      signal?: AbortSignal,
    ) => Promise<AgentToolResult<unknown>>
  },
): AgentTool {
  return def as AgentTool
}

export function createLinkedInTools(api: UnipileLinkedInAPI): AgentTool[] {
  return [
    // ── Account management ──

    defineTool({
      name: 'linkedin_list_accounts',
      label: 'List LinkedIn Accounts',
      description:
        '[LinkedIn] List all connected LinkedIn accounts. Use this to see which accounts are available and select one for operations.',
      parameters: Type.Object({}),
      async execute() {
        try {
          const result = await api.listAccounts()
          const linkedin = (result.items ?? []).filter((a) => a.type?.toUpperCase() === 'LINKEDIN')
          if (!linkedin.length) return toolResult('No LinkedIn accounts connected via Unipile.')
          return toolResult(JSON.stringify(linkedin, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_set_account',
      label: 'Set Active LinkedIn Account',
      description:
        '[LinkedIn] Set which LinkedIn account to use for subsequent operations. Use linkedin_list_accounts first to get account IDs.',
      parameters: Type.Object({
        account_id: Type.String({ description: 'The Unipile account ID to use' }),
      }),
      async execute(_id, params) {
        try {
          const account = await api.getAccount(params.account_id)
          api.setAccountId(params.account_id)
          return toolResult(
            `Active LinkedIn account set to: ${account.name ?? account.id} (${account.status})`,
          )
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Profile ──

    defineTool({
      name: 'linkedin_get_my_profile',
      label: 'Get My LinkedIn Profile',
      description: '[LinkedIn] Get your own LinkedIn profile information.',
      parameters: Type.Object({}),
      async execute() {
        try {
          const profile = await api.getMyProfile()
          return toolResult(JSON.stringify(profile, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_get_profile',
      label: 'Get LinkedIn Profile',
      description:
        '[LinkedIn] Get a LinkedIn user profile by their profile ID or public identifier.',
      parameters: Type.Object({
        profile_id: Type.String({
          description: 'Profile ID or public identifier (e.g., "john-doe-12345")',
        }),
      }),
      async execute(_id, params) {
        try {
          const profile = await api.getProfile(params.profile_id)
          return toolResult(JSON.stringify(profile, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Messaging ──

    defineTool({
      name: 'linkedin_list_chats',
      label: 'List LinkedIn Chats',
      description: '[LinkedIn] List your LinkedIn message conversations.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: 'Max chats to return (default: 20)' })),
        cursor: Type.Optional(
          Type.String({ description: 'Pagination cursor from previous response' }),
        ),
      }),
      async execute(_id, params) {
        try {
          const result = await api.listChats({
            limit: params.limit ?? 20,
            cursor: params.cursor,
          })
          return toolResult(JSON.stringify(result, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_list_messages',
      label: 'List Chat Messages',
      description: '[LinkedIn] List messages in a specific LinkedIn conversation.',
      parameters: Type.Object({
        chat_id: Type.String({ description: 'The chat/conversation ID' }),
        limit: Type.Optional(Type.Number({ description: 'Max messages to return (default: 20)' })),
        cursor: Type.Optional(Type.String({ description: 'Pagination cursor' })),
      }),
      async execute(_id, params) {
        try {
          const result = await api.listMessages(params.chat_id, {
            limit: params.limit ?? 20,
            cursor: params.cursor,
          })
          return toolResult(JSON.stringify(result, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_send_message',
      label: 'Send LinkedIn Message',
      description: '[LinkedIn] Send a message in an existing LinkedIn conversation.',
      parameters: Type.Object({
        chat_id: Type.String({ description: 'The chat/conversation ID to send to' }),
        text: Type.String({ description: 'Message text to send' }),
      }),
      async execute(_id, params) {
        try {
          const msg = await api.sendMessage(params.chat_id, params.text)
          return toolResult(`Message sent. ID: ${msg.id}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_start_chat',
      label: 'Start LinkedIn Chat',
      description:
        '[LinkedIn] Start a new LinkedIn conversation with a user. Requires their Unipile profile/attendee ID.',
      parameters: Type.Object({
        attendee_id: Type.String({
          description: 'The Unipile ID of the person to message',
        }),
        text: Type.String({ description: 'Initial message text' }),
      }),
      async execute(_id, params) {
        try {
          const chat = await api.startChat(params.attendee_id, params.text)
          return toolResult(`Chat started. Chat ID: ${chat.id}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Search ──

    defineTool({
      name: 'linkedin_search_people',
      label: 'Search LinkedIn People',
      description:
        '[LinkedIn] Search for people on LinkedIn by keyword (name, title, company, etc.).',
      parameters: Type.Object({
        query: Type.String({
          description: 'Search keywords (e.g., "software engineer San Francisco")',
        }),
        limit: Type.Optional(Type.Number({ description: 'Max results to return' })),
      }),
      async execute(_id, params) {
        try {
          const results = await api.searchPeople(params.query, {
            limit: params.limit,
          })
          return toolResult(JSON.stringify(results, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Invitations ──

    defineTool({
      name: 'linkedin_list_invitations',
      label: 'List LinkedIn Invitations',
      description: '[LinkedIn] List sent or received LinkedIn connection invitations.',
      parameters: Type.Object({
        direction: Type.String({
          description: '"sent" or "received"',
        }),
      }),
      async execute(_id, params) {
        try {
          const result =
            params.direction === 'received'
              ? await api.listReceivedInvitations()
              : await api.listSentInvitations()
          return toolResult(JSON.stringify(result, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_send_invitation',
      label: 'Send Connection Request',
      description: '[LinkedIn] Send a LinkedIn connection request to a user.',
      parameters: Type.Object({
        profile_id: Type.String({
          description: 'Profile ID of the person to invite',
        }),
        message: Type.Optional(
          Type.String({ description: 'Optional personalized message (max 300 chars)' }),
        ),
      }),
      async execute(_id, params) {
        try {
          await api.sendInvitation(params.profile_id, params.message)
          return toolResult('Connection request sent.')
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Posts ──

    defineTool({
      name: 'linkedin_create_post',
      label: 'Create LinkedIn Post',
      description: '[LinkedIn] Create a new post on LinkedIn.',
      parameters: Type.Object({
        text: Type.String({ description: 'Post content text' }),
      }),
      async execute(_id, params) {
        try {
          const post = await api.createPost(params.text)
          return toolResult(`Post created. ID: ${post.id}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_get_post',
      label: 'Get LinkedIn Post',
      description: '[LinkedIn] Get details of a LinkedIn post by ID.',
      parameters: Type.Object({
        post_id: Type.String({ description: 'The post ID' }),
      }),
      async execute(_id, params) {
        try {
          const post = await api.getPost(params.post_id)
          return toolResult(JSON.stringify(post, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_get_post_comments',
      label: 'Get Post Comments',
      description: '[LinkedIn] Get comments on a LinkedIn post.',
      parameters: Type.Object({
        post_id: Type.String({ description: 'The post ID' }),
        limit: Type.Optional(Type.Number({ description: 'Max comments to return' })),
      }),
      async execute(_id, params) {
        try {
          const result = await api.getPostComments(params.post_id, {
            limit: params.limit,
          })
          return toolResult(JSON.stringify(result, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_comment_on_post',
      label: 'Comment on Post',
      description: '[LinkedIn] Add a comment to a LinkedIn post.',
      parameters: Type.Object({
        post_id: Type.String({ description: 'The post ID to comment on' }),
        text: Type.String({ description: 'Comment text' }),
      }),
      async execute(_id, params) {
        try {
          await api.commentOnPost(params.post_id, params.text)
          return toolResult('Comment posted.')
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'linkedin_react_to_post',
      label: 'React to Post',
      description: '[LinkedIn] React to a LinkedIn post (like, celebrate, etc.).',
      parameters: Type.Object({
        post_id: Type.String({ description: 'The post ID to react to' }),
        reaction: Type.Optional(
          Type.String({
            description:
              'Reaction type: LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY (default: LIKE)',
          }),
        ),
      }),
      async execute(_id, params) {
        try {
          await api.reactToPost(params.post_id, params.reaction ?? 'LIKE')
          return toolResult(`Reacted with ${params.reaction ?? 'LIKE'}.`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── InMail ──

    defineTool({
      name: 'linkedin_inmail_balance',
      label: 'InMail Balance',
      description: '[LinkedIn] Check your remaining InMail credits.',
      parameters: Type.Object({}),
      async execute() {
        try {
          const result = await api.getInMailBalance()
          return toolResult(`InMail balance: ${result.balance ?? 'unknown'}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),
  ]
}
