/**
 * Webhooks subsystem barrel.
 *
 * See ./provider.ts for the WebhookProvider interface and ./router.ts for
 * the dispatcher. Concrete providers live under ./providers/.
 */

export { WebhookAgentRunner } from './agent-runner.js'
export type {
  CanonicalEvent,
  WebhookHandshakeResponse,
  WebhookProvider,
  WebhookRequest,
} from './provider.js'
export { SlackWebhookProvider, type SlackWebhookOpts } from './providers/slack.js'
export { TelegramWebhookProvider } from './providers/telegram.js'
export { WebhookRouter } from './router.js'
