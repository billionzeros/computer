const BASE = 'https://api.airtable.com/v0'

export interface AirtableBase {
  id: string
  name: string
  permissionLevel: string
}

export interface AirtableTable {
  id: string
  name: string
  description?: string
  fields: AirtableField[]
  primaryFieldId: string
}

export interface AirtableField {
  id: string
  name: string
  type: string
  description?: string
  options?: Record<string, unknown>
}

export interface AirtableRecord {
  id: string
  createdTime: string
  fields: Record<string, unknown>
}

export interface AirtableRecordList {
  records: AirtableRecord[]
  offset?: string
}

export class AirtableAPI {
  private token = ''

  setToken(token: string): void {
    this.token = token
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable API ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  async listBases(): Promise<{ bases: AirtableBase[] }> {
    return this.request('https://api.airtable.com/v0/meta/bases'.replace(BASE, ''))
  }

  async getBaseSchema(baseId: string): Promise<{ tables: AirtableTable[] }> {
    // Meta endpoint uses a different path
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable API ${res.status}: ${text}`)
    }
    return res.json() as Promise<{ tables: AirtableTable[] }>
  }

  async listRecords(
    baseId: string,
    tableIdOrName: string,
    opts: {
      maxRecords?: number
      pageSize?: number
      offset?: string
      filterByFormula?: string
      sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>
      fields?: string[]
      view?: string
    } = {},
  ): Promise<AirtableRecordList> {
    const params = new URLSearchParams()
    if (opts.maxRecords) params.set('maxRecords', String(opts.maxRecords))
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize))
    if (opts.offset) params.set('offset', opts.offset)
    if (opts.filterByFormula) params.set('filterByFormula', opts.filterByFormula)
    if (opts.view) params.set('view', opts.view)
    if (opts.fields) for (const f of opts.fields) params.append('fields[]', f)
    if (opts.sort) {
      for (const [i, s] of opts.sort.entries()) {
        params.set(`sort[${i}][field]`, s.field)
        if (s.direction) params.set(`sort[${i}][direction]`, s.direction)
      }
    }
    const qs = params.toString()
    const path = `/${baseId}/${encodeURIComponent(tableIdOrName)}${qs ? `?${qs}` : ''}`
    return this.request(path)
  }

  async getRecord(
    baseId: string,
    tableIdOrName: string,
    recordId: string,
  ): Promise<AirtableRecord> {
    return this.request(`/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`)
  }

  async createRecords(
    baseId: string,
    tableIdOrName: string,
    records: Array<{ fields: Record<string, unknown> }>,
  ): Promise<{ records: AirtableRecord[] }> {
    return this.request(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
      method: 'POST',
      body: JSON.stringify({ records }),
    })
  }

  async updateRecords(
    baseId: string,
    tableIdOrName: string,
    records: Array<{ id: string; fields: Record<string, unknown> }>,
  ): Promise<{ records: AirtableRecord[] }> {
    return this.request(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    })
  }

  async deleteRecords(
    baseId: string,
    tableIdOrName: string,
    recordIds: string[],
  ): Promise<{ records: Array<{ id: string; deleted: boolean }> }> {
    const params = recordIds.map((id) => `records[]=${id}`).join('&')
    return this.request(`/${baseId}/${encodeURIComponent(tableIdOrName)}?${params}`, {
      method: 'DELETE',
    })
  }

  async whoami(): Promise<{ id: string; email?: string }> {
    const res = await fetch('https://api.airtable.com/v0/meta/whoami', {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable API ${res.status}: ${text}`)
    }
    return res.json() as Promise<{ id: string; email?: string }>
  }
}
