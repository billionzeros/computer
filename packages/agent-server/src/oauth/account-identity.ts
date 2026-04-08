/**
 * After OAuth completes, fetch the account identity (email/username) from the
 * provider so we can display it in the UI without requiring manual labeling.
 */

export async function fetchAccountIdentity(
  registryId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const provider = resolveProvider(registryId)
    switch (provider) {
      case 'google':
        return await fetchGoogleIdentity(accessToken)
      case 'github':
        return await fetchGithubIdentity(accessToken)
      case 'notion':
        return await fetchNotionIdentity(accessToken)
      case 'slack':
        return await fetchSlackIdentity(accessToken)
      case 'linear':
        return await fetchLinearIdentity(accessToken)
      default:
        return null
    }
  } catch (err) {
    console.warn(`[account-identity] Failed to fetch identity for ${registryId}:`, err)
    return null
  }
}

/**
 * Map registryId → canonical provider for identity lookup.
 * Google services (gmail, google-drive, etc.) all share the same userinfo endpoint.
 */
function resolveProvider(registryId: string): string {
  const googleServices = [
    'gmail',
    'google-drive',
    'google-calendar',
    'google-docs',
    'google-sheets',
    'google-search-console',
  ]
  if (googleServices.includes(registryId)) return 'google'
  return registryId
}

async function fetchGoogleIdentity(token: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { email?: string }
  return data.email ?? null
}

async function fetchGithubIdentity(token: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { login?: string }
  return data.login ?? null
}

async function fetchNotionIdentity(token: string): Promise<string | null> {
  const res = await fetch('https://api.notion.com/v1/users/me', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    name?: string
    person?: { email?: string }
  }
  return data.person?.email ?? data.name ?? null
}

async function fetchSlackIdentity(token: string): Promise<string | null> {
  const res = await fetch('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { ok?: boolean; user?: string; team?: string }
  if (!data.ok) return null
  return data.team ? `${data.user}@${data.team}` : data.user ?? null
}

async function fetchLinearIdentity(token: string): Promise<string | null> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '{ viewer { email } }' }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { data?: { viewer?: { email?: string } } }
  return data.data?.viewer?.email ?? null
}
