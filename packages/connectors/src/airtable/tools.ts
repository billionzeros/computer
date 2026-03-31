import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { type Static, type TSchema, Type } from '@sinclair/typebox'
import type { AirtableAPI } from './api.js'

function toolResult(output: string, isError = false) {
  return { content: [{ type: 'text' as const, text: output }], details: { raw: output, isError } }
}

function defineTool<T extends TSchema>(
  def: Omit<AgentTool<T>, 'execute'> & {
    execute: (
      id: string,
      params: Static<T>,
      signal?: AbortSignal,
    ) => Promise<AgentToolResult<unknown>>
  },
): AgentTool {
  return def as AgentTool
}

export function createAirtableTools(api: AirtableAPI): AgentTool[] {
  return [
    defineTool({
      name: 'airtable_list_bases',
      label: 'List Bases',
      description: '[Airtable] List all accessible Airtable bases.',
      parameters: Type.Object({}),
      async execute() {
        try {
          const { bases } = await api.listBases()
          const summary = bases.map((b) => ({ id: b.id, name: b.name, permission: b.permissionLevel }))
          return toolResult(JSON.stringify(summary, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'airtable_get_base_schema',
      label: 'Get Base Schema',
      description: '[Airtable] Get all tables and their fields for an Airtable base.',
      parameters: Type.Object({
        base_id: Type.String({ description: 'Airtable base ID (e.g., appXXXXXXXXXXXXXX)' }),
      }),
      async execute(_id, params) {
        try {
          const { tables } = await api.getBaseSchema(params.base_id)
          const summary = tables.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            fields: t.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
          }))
          return toolResult(JSON.stringify(summary, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'airtable_list_records',
      label: 'List Records',
      description:
        '[Airtable] List records from a table. Supports filtering, sorting, field selection, and pagination.',
      parameters: Type.Object({
        base_id: Type.String({ description: 'Airtable base ID' }),
        table: Type.String({ description: 'Table name or ID' }),
        filter_by_formula: Type.Optional(
          Type.String({ description: 'Airtable formula to filter records (e.g., "{Status} = \'Done\'")' }),
        ),
        sort_json: Type.Optional(
          Type.String({
            description:
              'Sort as JSON array, e.g. [{"field":"Name","direction":"asc"}]',
          }),
        ),
        fields: Type.Optional(
          Type.String({ description: 'Comma-separated field names to return' }),
        ),
        max_records: Type.Optional(Type.Number({ description: 'Maximum number of records (default: 100)' })),
        view: Type.Optional(Type.String({ description: 'View name or ID to use' })),
        offset: Type.Optional(Type.String({ description: 'Pagination offset from previous response' })),
      }),
      async execute(_id, params) {
        try {
          const sort = params.sort_json ? JSON.parse(params.sort_json) : undefined
          const fields = params.fields ? params.fields.split(',').map((f) => f.trim()) : undefined
          const result = await api.listRecords(params.base_id, params.table, {
            maxRecords: params.max_records ?? 100,
            filterByFormula: params.filter_by_formula,
            sort,
            fields,
            view: params.view,
            offset: params.offset,
          })
          const output: Record<string, unknown> = {
            records: result.records.map((r) => ({ id: r.id, fields: r.fields })),
          }
          if (result.offset) output.offset = result.offset
          return toolResult(JSON.stringify(output, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'airtable_get_record',
      label: 'Get Record',
      description: '[Airtable] Get a single record by ID.',
      parameters: Type.Object({
        base_id: Type.String({ description: 'Airtable base ID' }),
        table: Type.String({ description: 'Table name or ID' }),
        record_id: Type.String({ description: 'Record ID (e.g., recXXXXXXXXXXXXXX)' }),
      }),
      async execute(_id, params) {
        try {
          const record = await api.getRecord(params.base_id, params.table, params.record_id)
          return toolResult(JSON.stringify({ id: record.id, fields: record.fields }, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'airtable_create_records',
      label: 'Create Records',
      description: '[Airtable] Create one or more records in a table.',
      parameters: Type.Object({
        base_id: Type.String({ description: 'Airtable base ID' }),
        table: Type.String({ description: 'Table name or ID' }),
        records_json: Type.String({
          description:
            'JSON array of records to create, e.g. [{"fields":{"Name":"Alice","Status":"Active"}}]',
        }),
      }),
      async execute(_id, params) {
        try {
          const records = JSON.parse(params.records_json)
          const result = await api.createRecords(params.base_id, params.table, records)
          const summary = result.records.map((r) => ({ id: r.id, fields: r.fields }))
          return toolResult(JSON.stringify(summary, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'airtable_update_records',
      label: 'Update Records',
      description: '[Airtable] Update one or more existing records (partial update).',
      parameters: Type.Object({
        base_id: Type.String({ description: 'Airtable base ID' }),
        table: Type.String({ description: 'Table name or ID' }),
        records_json: Type.String({
          description:
            'JSON array of records to update, e.g. [{"id":"recXXX","fields":{"Status":"Done"}}]',
        }),
      }),
      async execute(_id, params) {
        try {
          const records = JSON.parse(params.records_json)
          const result = await api.updateRecords(params.base_id, params.table, records)
          const summary = result.records.map((r) => ({ id: r.id, fields: r.fields }))
          return toolResult(JSON.stringify(summary, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'airtable_delete_records',
      label: 'Delete Records',
      description: '[Airtable] Delete one or more records by ID.',
      parameters: Type.Object({
        base_id: Type.String({ description: 'Airtable base ID' }),
        table: Type.String({ description: 'Table name or ID' }),
        record_ids: Type.String({ description: 'Comma-separated record IDs to delete' }),
      }),
      async execute(_id, params) {
        try {
          const ids = params.record_ids.split(',').map((id) => id.trim())
          const result = await api.deleteRecords(params.base_id, params.table, ids)
          return toolResult(JSON.stringify(result.records, null, 2))
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),
  ]
}
