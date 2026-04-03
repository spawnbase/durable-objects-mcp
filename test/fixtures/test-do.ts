import { DurableObject } from 'cloudflare:workers'

/**
 * Minimal SQLite-backed DO for integration tests.
 * Implements the same query() contract as production DOs.
 */
export class TestQueryableDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          value TEXT
        )
      `)
      ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO items (id, name, value) VALUES (1, 'alpha', 'one'), (2, 'beta', 'two'), (3, 'gamma', 'three')",
      )
    })
  }

  query(sql: string) {
    const cursor = this.ctx.storage.sql.exec(sql)
    return { columns: cursor.columnNames, rows: [...cursor.raw()] }
  }
}
