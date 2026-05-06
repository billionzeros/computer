const CONTROL_PLANE_HOSTS = new Set(['console.antoncomputer.in'])

export function isControlPlaneHost(host: string | null | undefined): boolean {
  return !!host && CONTROL_PLANE_HOSTS.has(host.toLowerCase())
}

export function qualifyPublicUrl(publicPathOrUrl: string, domain: string | null): string {
  if (/^https?:\/\//i.test(publicPathOrUrl)) {
    try {
      const url = new URL(publicPathOrUrl)
      if (domain && isControlPlaneHost(url.host)) {
        return `https://${domain}${url.pathname}${url.search}${url.hash}`
      }
    } catch {
      return publicPathOrUrl
    }
    return publicPathOrUrl
  }

  if (publicPathOrUrl.startsWith('/')) {
    return domain ? `https://${domain}${publicPathOrUrl}` : publicPathOrUrl
  }

  return domain ? `https://${domain}/${publicPathOrUrl}` : `/${publicPathOrUrl}`
}

export function buildArtifactPublicUrl(slug: string, domain: string | null): string {
  return qualifyPublicUrl(`/a/${slug}`, domain)
}
