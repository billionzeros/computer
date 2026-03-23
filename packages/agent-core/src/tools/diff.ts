/**
 * Diff tool — structured file comparison and patching.
 */

import { execSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'

export interface DiffInput {
  operation: 'compare' | 'patch'
  file_a: string
  file_b?: string
  patch_content?: string
}

export function executeDiff(input: DiffInput): string {
  switch (input.operation) {
    case 'compare': {
      if (!input.file_a) return 'Error: file_a is required.'
      if (!input.file_b) return 'Error: file_b is required for compare.'
      if (!existsSync(input.file_a)) return `Error: file not found: ${input.file_a}`
      if (!existsSync(input.file_b)) return `Error: file not found: ${input.file_b}`

      try {
        const output = execSync(`diff -u "${input.file_a}" "${input.file_b}"`, {
          encoding: 'utf-8',
          timeout: 10_000,
        })
        return output || 'Files are identical.'
      } catch (err: unknown) {
        const e = err as { status?: number; stdout?: string; stderr?: string; message: string }
        // diff exits with 1 when files differ (that's normal)
        if (e.status === 1 && e.stdout) return e.stdout.trim()
        return `Error: ${e.stderr?.trim() || e.message}`
      }
    }

    case 'patch': {
      if (!input.file_a) return 'Error: file_a is required.'
      if (!input.patch_content) return 'Error: patch_content is required for patch.'
      if (!existsSync(input.file_a)) return `Error: file not found: ${input.file_a}`

      try {
        // Write patch to temp file
        const patchFile = `/tmp/anton_patch_${Date.now()}.patch`
        writeFileSync(patchFile, input.patch_content, 'utf-8')
        const output = execSync(`patch "${input.file_a}" "${patchFile}"`, {
          encoding: 'utf-8',
          timeout: 10_000,
        })
        return output.trim() || 'Patch applied successfully.'
      } catch (err: unknown) {
        const e = err as { stderr?: string; message: string }
        return `Error applying patch: ${e.stderr?.trim() || e.message}`
      }
    }

    default:
      return `Error: unknown operation "${input.operation}".`
  }
}
