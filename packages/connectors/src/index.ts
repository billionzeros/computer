export { ConnectorManager } from './connector-manager.js'
export type { DirectConnector, ConnectorFactory, TokenGetter } from './types.js'

export { SlackConnector } from './slack/index.js'
export { GitHubConnector } from './github/index.js'
export { GmailConnector } from './gmail/index.js'
export { NotionConnector } from './notion/index.js'
export { TelegramConnector } from './telegram/index.js'
export { ExaConnector } from './exa/index.js'
export { GoogleCalendarConnector } from './google-calendar/index.js'
export { GoogleDriveConnector } from './google-drive/index.js'
export { LinearConnector } from './linear/index.js'
export { GranolaConnector } from './granola/index.js'
export { GoogleDocsConnector } from './google-docs/index.js'
export { GoogleSheetsConnector } from './google-sheets/index.js'
export { GoogleSearchConsoleConnector } from './google-search-console/index.js'
export { AirtableConnector } from './airtable/index.js'
export { LinkedInConnector } from './linkedin/index.js'

import { AirtableConnector } from './airtable/index.js'
import { ExaConnector } from './exa/index.js'
import { GitHubConnector } from './github/index.js'
import { GmailConnector } from './gmail/index.js'
import { GoogleCalendarConnector } from './google-calendar/index.js'
import { GoogleDocsConnector } from './google-docs/index.js'
import { GoogleDriveConnector } from './google-drive/index.js'
import { GoogleSearchConsoleConnector } from './google-search-console/index.js'
import { GoogleSheetsConnector } from './google-sheets/index.js'
import { GranolaConnector } from './granola/index.js'
import { LinearConnector } from './linear/index.js'
import { LinkedInConnector } from './linkedin/index.js'
import { NotionConnector } from './notion/index.js'
import { SlackConnector } from './slack/index.js'
import { TelegramConnector } from './telegram/index.js'
import type { ConnectorFactory } from './types.js'

/** Built-in direct connector factories keyed by provider ID. */
export const CONNECTOR_FACTORIES: Record<string, ConnectorFactory> = {
  slack: () => new SlackConnector(),
  github: () => new GitHubConnector(),
  gmail: () => new GmailConnector(),
  notion: () => new NotionConnector(),
  telegram: () => new TelegramConnector(),
  'exa-search': () => new ExaConnector(),
  'google-calendar': () => new GoogleCalendarConnector(),
  'google-drive': () => new GoogleDriveConnector(),
  linear: () => new LinearConnector(),
  granola: () => new GranolaConnector(),
  'google-docs': () => new GoogleDocsConnector(),
  'google-sheets': () => new GoogleSheetsConnector(),
  'google-search-console': () => new GoogleSearchConsoleConnector(),
  airtable: () => new AirtableConnector(),
  linkedin: () => new LinkedInConnector(),
}
