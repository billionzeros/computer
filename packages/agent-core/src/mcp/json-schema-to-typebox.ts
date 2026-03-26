/**
 * Convert JSON Schema (from MCP tool inputSchema) to Typebox schemas
 * that pi SDK's AgentTool expects.
 *
 * Handles the common subset: object, string, number, boolean, array, enum.
 */

import { Type, type TSchema } from '@sinclair/typebox'

export function jsonSchemaToTypebox(schema: Record<string, unknown>): TSchema {
  if (!schema || typeof schema !== 'object') {
    return Type.Object({})
  }

  const type = schema.type as string | undefined

  switch (type) {
    case 'object':
      return convertObject(schema)
    case 'string':
      return convertString(schema)
    case 'number':
    case 'integer':
      return convertNumber(schema)
    case 'boolean':
      return Type.Boolean(descOpts(schema))
    case 'array':
      return convertArray(schema)
    case 'null':
      return Type.Null(descOpts(schema))
    default:
      // If no type but has properties, treat as object
      if (schema.properties) return convertObject(schema)
      // Fallback: accept anything
      return Type.Unknown(descOpts(schema))
  }
}

function convertObject(schema: Record<string, unknown>): TSchema {
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>
  const required = new Set((schema.required || []) as string[])

  const props: Record<string, TSchema> = {}

  for (const [key, propSchema] of Object.entries(properties)) {
    const converted = jsonSchemaToTypebox(propSchema)
    props[key] = required.has(key) ? converted : Type.Optional(converted)
  }

  return Type.Object(props, descOpts(schema))
}

function convertString(schema: Record<string, unknown>): TSchema {
  // Handle enum
  if (schema.enum && Array.isArray(schema.enum)) {
    return Type.Union(
      (schema.enum as string[]).map((v) => Type.Literal(v)),
      descOpts(schema),
    )
  }
  return Type.String(descOpts(schema))
}

function convertNumber(schema: Record<string, unknown>): TSchema {
  if (schema.enum && Array.isArray(schema.enum)) {
    return Type.Union(
      (schema.enum as number[]).map((v) => Type.Literal(v)),
      descOpts(schema),
    )
  }
  return schema.type === 'integer' ? Type.Integer(descOpts(schema)) : Type.Number(descOpts(schema))
}

function convertArray(schema: Record<string, unknown>): TSchema {
  const items = schema.items as Record<string, unknown> | undefined
  const itemSchema = items ? jsonSchemaToTypebox(items) : Type.Unknown()
  return Type.Array(itemSchema, descOpts(schema))
}

function descOpts(schema: Record<string, unknown>): { description?: string } {
  return schema.description ? { description: schema.description as string } : {}
}
