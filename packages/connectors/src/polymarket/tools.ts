import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { type Static, type TSchema, Type } from '@sinclair/typebox'
import type { PolymarketAPI, PolymarketL2Creds, PolymarketMode } from './api.js'

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

function pretty(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

export function createPolymarketTools(api: PolymarketAPI): AgentTool[] {
  return [
    defineTool({
      name: 'polymarket_set_mode',
      label: 'Set Mode',
      description:
        '[Polymarket] Configure connector mode. Use "read" for public data/portfolio; "trade" to enable authenticated CLOB endpoints (requires L2 creds).',
      parameters: Type.Object({
        mode: Type.Union([Type.Literal('read'), Type.Literal('trade')], {
          description: 'Connector mode',
        }),
      }),
      async execute(_id, params) {
        try {
          api.setMode(params.mode as PolymarketMode)
          return toolResult(`OK. Polymarket mode set to "${params.mode}".`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_set_wallet',
      label: 'Set Wallet',
      description:
        '[Polymarket] Optional override: set a different public wallet for this session. The connector already uses the wallet saved in connector settings — do not ask the user for it unless they want to query another address.',
      parameters: Type.Object({
        wallet_address: Type.String({ description: '0x-prefixed wallet address' }),
      }),
      async execute(_id, params) {
        try {
          api.setWalletAddress(params.wallet_address)
          return toolResult(`OK. Wallet address set to ${params.wallet_address}.`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_set_clob_l2',
      label: 'Set CLOB L2 Credentials',
      description:
        '[Polymarket] Set CLOB L2 API credentials for authenticated endpoints. Provide apiKey/secret/passphrase/address.',
      parameters: Type.Object({
        apiKey: Type.String({ description: 'CLOB L2 apiKey (UUID string)' }),
        secret: Type.String({ description: 'CLOB L2 secret (base64/base64url)' }),
        passphrase: Type.String({ description: 'CLOB L2 passphrase' }),
        address: Type.String({ description: 'Signer address associated with the apiKey' }),
      }),
      async execute(_id, params) {
        try {
          api.setL2Creds(params as unknown as PolymarketL2Creds)
          api.setMode('trade')
          return toolResult('OK. CLOB L2 creds set and mode switched to "trade".')
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Read: discovery + market data ────────────────────────────────
    defineTool({
      name: 'polymarket_search',
      label: 'Search',
      description: '[Polymarket] Search markets, events, and profiles (Gamma API).',
      parameters: Type.Object({
        q: Type.String({ description: 'Search query' }),
        limit_per_type: Type.Optional(Type.Number({ description: 'Per-type limit (optional)' })),
        page: Type.Optional(Type.Number({ description: 'Page number (optional)' })),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.searchPublic(
            params.q,
            {
              limit_per_type: params.limit_per_type,
              page: params.page,
            },
            signal,
          )
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_list_markets',
      label: 'List Markets',
      description: '[Polymarket] List markets (Gamma API). Supports passing common query filters.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: 'Max results (optional)' })),
        offset: Type.Optional(Type.Number({ description: 'Offset (optional)' })),
        active: Type.Optional(Type.Boolean({ description: 'Only active markets (optional)' })),
        closed: Type.Optional(Type.Boolean({ description: 'Only closed markets (optional)' })),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.listMarkets(
            {
              limit: params.limit,
              offset: params.offset,
              active: params.active,
              closed: params.closed,
            },
            signal,
          )
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_get_market',
      label: 'Get Market',
      description: '[Polymarket] Get a market by id or slug (Gamma API).',
      parameters: Type.Object({
        id: Type.Optional(Type.Number({ description: 'Market numeric id' })),
        slug: Type.Optional(Type.String({ description: 'Market slug' })),
      }),
      async execute(_id, params, signal) {
        try {
          const data =
            typeof params.id === 'number'
              ? await api.getMarketById(params.id, signal)
              : params.slug
                ? await api.getMarketBySlug(params.slug, signal)
                : null
          if (!data) return toolResult('Error: provide either `id` or `slug`.', true)
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_get_orderbook',
      label: 'Get Orderbook',
      description: '[Polymarket] Get orderbook for a token id (CLOB public endpoint).',
      parameters: Type.Object({
        token_id: Type.String({ description: 'Asset/token id (token_id)' }),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.getOrderBook(params.token_id, signal)
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_get_midpoint',
      label: 'Get Midpoint',
      description: '[Polymarket] Get midpoint price for a token id (CLOB public endpoint).',
      parameters: Type.Object({
        token_id: Type.String({ description: 'Asset/token id (token_id)' }),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.getMidpoint(params.token_id, signal)
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Read: portfolio tracking ─────────────────────────────────────
    defineTool({
      name: 'polymarket_get_positions',
      label: 'Get Positions',
      description:
        '[Polymarket] Get current positions for the wallet configured on this connector (Data API). Do not ask the user for their address unless they want to look up a different wallet.',
      parameters: Type.Object({
        user: Type.Optional(
          Type.String({
            description:
              'Optional. Only pass to query a wallet other than the one saved in connector settings.',
          }),
        ),
        limit: Type.Optional(Type.Number({ description: 'Max results (default 100, max 500)' })),
        offset: Type.Optional(Type.Number({ description: 'Offset (default 0)' })),
        sizeThreshold: Type.Optional(Type.Number({ description: 'Size threshold (default 1)' })),
        sortBy: Type.Optional(
          Type.Union([
            Type.Literal('CURRENT'),
            Type.Literal('INITIAL'),
            Type.Literal('TOKENS'),
            Type.Literal('CASHPNL'),
            Type.Literal('PERCENTPNL'),
            Type.Literal('TITLE'),
            Type.Literal('RESOLVING'),
            Type.Literal('PRICE'),
            Type.Literal('AVGPRICE'),
          ]),
        ),
        sortDirection: Type.Optional(Type.Union([Type.Literal('ASC'), Type.Literal('DESC')])),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.getPositions(
            params.user,
            {
              limit: params.limit,
              offset: params.offset,
              sizeThreshold: params.sizeThreshold,
              sortBy: params.sortBy,
              sortDirection: params.sortDirection,
            },
            signal,
          )
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_get_portfolio_value',
      label: 'Get Portfolio Value',
      description:
        '[Polymarket] Get total value of positions for the wallet configured on this connector (Data API). Do not ask the user for their address unless they want another wallet.',
      parameters: Type.Object({
        user: Type.Optional(
          Type.String({
            description:
              'Optional. Only pass to query a wallet other than the one saved in connector settings.',
          }),
        ),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.getPortfolioValue(params.user, signal)
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    // ── Write: authenticated CLOB endpoints ───────────────────────────
    defineTool({
      name: 'polymarket_get_open_orders',
      label: 'Get Open Orders',
      description: '[Polymarket] Get authenticated user open orders (CLOB). Requires L2 creds.',
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: 'Filter by order id/hash' })),
        market: Type.Optional(Type.String({ description: 'Filter by market condition id' })),
        asset_id: Type.Optional(Type.String({ description: 'Filter by asset id/token id' })),
        next_cursor: Type.Optional(Type.String({ description: 'Pagination cursor (base64)' })),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.getUserOrders(params, signal)
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_post_signed_order',
      label: 'Post Signed Order',
      description:
        '[Polymarket] Post a pre-signed order payload to the CLOB. Requires L2 creds. You must supply a fully formed `SendOrder` payload (including `order.signature`).',
      parameters: Type.Object({
        payload: Type.Any({
          description:
            'Full SendOrder JSON payload for POST /order (includes `order`, `owner`, optionally `orderType`, `deferExec`, `postOnly`)',
        }),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.postSignedOrder(params.payload, signal)
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'polymarket_cancel_order',
      label: 'Cancel Order',
      description: '[Polymarket] Cancel an order by orderID/hash. Requires L2 creds.',
      parameters: Type.Object({
        orderID: Type.String({ description: 'Order id/hash to cancel' }),
      }),
      async execute(_id, params, signal) {
        try {
          const data = await api.cancelOrder(params.orderID, signal)
          return toolResult(pretty(data))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),
  ]
}
