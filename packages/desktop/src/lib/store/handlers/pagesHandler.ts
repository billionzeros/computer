import type { AiMessage } from '@anton/protocol'
import { pagesStore } from '../pagesStore.js'

export function handlePagesMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    case 'published_list_response': {
      pagesStore.getState().setPages(msg.pages, msg.host)
      return true
    }
    case 'unpublish_response': {
      if (!msg.success) {
        console.error(`[Pages] Unpublish failed for ${msg.slug}: ${msg.error}`)
        // Re-fetch to restore state
        pagesStore.getState().requestPages()
      }
      return true
    }
    default:
      return false
  }
}
