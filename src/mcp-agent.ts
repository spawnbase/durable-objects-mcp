import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { z } from 'zod'

import { assertReadOnly } from './sql-guard'

const MAX_SQL_LENGTH = 10_000

const classNameSchema = z
  .string()
  .min(1)
  .describe('DO binding name from list_classes')
const instanceNameSchema = z
  .string()
  .min(1)
  .describe(
    'DO instance name (e.g. userId) or hex ID (64-char hex from dashboard)',
  )
const sqlSchema = z
  .string()
  .min(1)
  .max(MAX_SQL_LENGTH)
  .describe('Read-only SQL query (SQLite syntax)')

export const HEX_ID_RE = /^[0-9a-f]{64}$/i

export function getStub(ns: DurableObjectNamespace, nameOrId: string) {
  if (HEX_ID_RE.test(nameOrId)) {
    return ns.get(ns.idFromString(nameOrId))
  }
  return ns.getByName(nameOrId)
}

/**
 * Retry RPC calls with exponential backoff per CF DO best practices.
 * Creates a fresh stub per attempt (broken stubs can't be reused).
 * Never retries overloaded errors.
 */
export async function callWithRetry(
  ns: DurableObjectNamespace,
  nameOrId: string,
  sql: string,
  maxAttempts = 3,
): Promise<unknown> {
  let attempt = 0
  while (true) {
    try {
      const stub = getStub(ns, nameOrId)
      return await (
        stub as unknown as { query: (sql: string) => unknown }
      ).query(sql)
    } catch (e: unknown) {
      const err = e as {
        retryable?: boolean
        overloaded?: boolean
        message?: string
      }
      if (!err.retryable || err.overloaded) {
        console.error('DO RPC failed (non-retryable)', {
          class: nameOrId,
          attempt,
          overloaded: err.overloaded,
          message: err.message,
        })
        throw e
      }
      attempt++
      if (attempt >= maxAttempts) {
        console.error('DO RPC failed after max retries', {
          class: nameOrId,
          attempts: attempt,
          message: err.message,
        })
        throw e
      }
      const backoff = Math.min(5000, 100 * Math.random() * Math.pow(2, attempt))
      console.warn('DO RPC retrying', {
        class: nameOrId,
        attempt,
        backoffMs: Math.round(backoff),
        message: err.message,
      })
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
}

// Bindings to exclude from auto-discovery (not queryable DOs)
export const EXCLUDED_BINDINGS = new Set(['DO_MCP_AGENT', 'OAUTH_KV'])

export function getQueryableDOs(
  env: Env,
): Record<string, DurableObjectNamespace> {
  const result: Record<string, DurableObjectNamespace> = {}
  for (const [key, binding] of Object.entries(env)) {
    if (
      !EXCLUDED_BINDINGS.has(key) &&
      typeof binding === 'object' &&
      binding !== null &&
      'idFromName' in binding
    ) {
      result[key] = binding as DurableObjectNamespace
    }
  }
  return result
}

export class DurableObjectsMcpAgent extends McpAgent<
  Env,
  Record<string, never>,
  Record<string, never>
> {
  server = new McpServer({
    name: 'Durable Objects MCP',
    version: '0.0.1',
  })

  async init() {
    const namespaces = getQueryableDOs(this.env)

    this.server.registerTool(
      'list_classes',
      {
        description: 'List queryable Durable Object classes',
        inputSchema: {},
      },
      async () => {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { classes: Object.keys(namespaces) },
                null,
                2,
              ),
            },
          ],
        }
      },
    )

    this.server.registerTool(
      'describe_schema',
      {
        description:
          'List tables and columns in a Durable Object instance SQLite database',
        inputSchema: {
          class_name: classNameSchema,
          name: instanceNameSchema,
        },
      },
      async ({ class_name, name }) => {
        const ns = namespaces[class_name]
        if (!ns) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Unknown class: ${class_name}. Use list_classes to see available classes.`,
              },
            ],
            isError: true,
          }
        }

        try {
          const result = await callWithRetry(
            ns,
            name,
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(result, null, 2) },
            ],
          }
        } catch (e) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to describe schema: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          }
        }
      },
    )

    this.server.registerTool(
      'execute_read_query',
      {
        description:
          'Execute a read-only SQL query (SELECT, EXPLAIN, WITH) against a Durable Object instance SQLite database.',
        inputSchema: {
          class_name: classNameSchema,
          name: instanceNameSchema,
          sql: sqlSchema,
        },
      },
      async ({ class_name, name, sql }) => {
        const ns = namespaces[class_name]
        if (!ns) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Unknown class: ${class_name}. Use list_classes to see available classes.`,
              },
            ],
            isError: true,
          }
        }

        try {
          assertReadOnly(sql)
        } catch (e) {
          return {
            content: [
              {
                type: 'text' as const,
                text: e instanceof Error ? e.message : String(e),
              },
            ],
            isError: true,
          }
        }

        try {
          const result = await callWithRetry(ns, name, sql)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          }
        } catch (e) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `SQL error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          }
        }
      },
    )
  }
}
