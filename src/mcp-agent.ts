import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { z } from 'zod'

import { assertReadOnly } from './sql-guard'

const MAX_ROWS = 100

// DO namespaces configured in wrangler.jsonc — maps display name to env binding key
const DO_CONFIG: Record<string, string> = {
  // "AIAgent": "AI_AGENT",
  // "WorkflowDraft": "WORKFLOW_DRAFT",
  // "SpawnbaseAgent": "SPAWNBASE_AGENT",
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
    this.server.registerTool(
      'list_classes',
      {
        description: 'List queryable Durable Object classes',
        inputSchema: {},
      },
      async () => {
        const classes = Object.keys(DO_CONFIG)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ classes }, null, 2),
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
          class_name: z.string().describe('DO class name from list_classes'),
          name: z
            .string()
            .describe(
              'DO instance name (e.g. userId). Used with idFromName().',
            ),
        },
      },
      async ({ class_name, name }) => {
        const bindingKey = DO_CONFIG[class_name]
        if (!bindingKey) {
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

        const ns = (this.env as Record<string, DurableObjectNamespace>)[
          bindingKey
        ]
        const id = ns.idFromName(name)
        const stub = ns.get(id)
        const result = await (stub as any).query(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        }
      },
    )

    this.server.registerTool(
      'query',
      {
        description:
          'Execute read-only SQL against a Durable Object instance. Only SELECT, PRAGMA, EXPLAIN, WITH allowed.',
        inputSchema: {
          class_name: z.string().describe('DO class name from list_classes'),
          name: z
            .string()
            .describe(
              'DO instance name (e.g. userId). Used with idFromName().',
            ),
          sql: z.string().describe('Read-only SQL query'),
        },
      },
      async ({ class_name, name, sql }) => {
        const bindingKey = DO_CONFIG[class_name]
        if (!bindingKey) {
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

        const ns = (this.env as Record<string, DurableObjectNamespace>)[
          bindingKey
        ]
        const id = ns.idFromName(name)
        const stub = ns.get(id)

        const limitedSql = sql.includes('LIMIT')
          ? sql
          : `${sql.replace(/;?\s*$/, '')} LIMIT ${MAX_ROWS}`

        try {
          const result = await (stub as any).query(limitedSql)
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
