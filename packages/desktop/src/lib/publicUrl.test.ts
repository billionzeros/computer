import { describe, expect, it } from 'vitest'
import { buildArtifactPublicUrl, qualifyPublicUrl } from './publicUrl.js'

describe('public URL helpers', () => {
  it('builds artifact URLs from the public Anton host', () => {
    expect(buildArtifactPublicUrl('huddle01-aws-rtx-pricing', 'itsomg.antoncomputer.in')).toBe(
      'https://itsomg.antoncomputer.in/a/huddle01-aws-rtx-pricing',
    )
  })

  it('rewrites stale console URLs to the public Anton host', () => {
    expect(
      qualifyPublicUrl(
        'https://console.antoncomputer.in/a/huddle01-aws-rtx-pricing',
        'itsomg.antoncomputer.in',
      ),
    ).toBe('https://itsomg.antoncomputer.in/a/huddle01-aws-rtx-pricing')
  })

  it('preserves non-console absolute URLs', () => {
    expect(qualifyPublicUrl('https://example.com/a/page', 'itsomg.antoncomputer.in')).toBe(
      'https://example.com/a/page',
    )
  })
})
