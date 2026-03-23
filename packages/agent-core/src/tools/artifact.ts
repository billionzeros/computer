/**
 * Artifact tool — creates rich visual content displayed in the desktop side panel.
 * Supports HTML apps, code files, markdown documents, SVG diagrams, and mermaid charts.
 *
 * If a filename is provided, the content is also written to disk.
 * The actual rendering happens client-side — the tool just returns a confirmation.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface ArtifactInput {
  title: string
  type: 'html' | 'code' | 'markdown' | 'svg' | 'mermaid'
  language?: string
  content: string
  filename?: string
}

export function executeArtifact(input: ArtifactInput): string {
  const { title, type, content, filename } = input

  // Optionally save to disk
  if (filename) {
    try {
      mkdirSync(dirname(filename), { recursive: true })
      writeFileSync(filename, content, 'utf-8')
    } catch (err: unknown) {
      return `Error writing ${filename}: ${(err as Error).message}`
    }
  }

  const savedNote = filename ? ` Saved to ${filename}.` : ''
  const sizeNote = `${content.length} chars`

  return `Artifact "${title}" created (${type}, ${sizeNote}).${savedNote}`
}
