/**
 * Side-effect module: registers built-in mention providers on import.
 *
 * Import this once from the composer so providers are available before
 * the user types their first `@`. Keeping registration isolated here
 * avoids mixing it into component render paths.
 *
 * Future providers (agents, web, chat, notes, terminal) register here.
 */
import { filesProvider } from './filesProvider.js'
import { mentionRegistry } from './registry.js'

mentionRegistry.register(filesProvider)
