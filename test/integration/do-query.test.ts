import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('DO query() contract', () => {
  function getStub() {
    const ns = env.TEST_DO as DurableObjectNamespace
    return ns.get(ns.idFromName('test-instance'))
  }

  it('returns columns and rows for SELECT', async () => {
    const stub = getStub()
    const result = await (stub as any).query('SELECT * FROM items')

    expect(result.columns).toEqual(['id', 'name', 'value'])
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0]).toEqual([1, 'alpha', 'one'])
  })

  it('returns schema via sqlite_master', async () => {
    const stub = getStub()
    const result = await (stub as any).query(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )

    expect(result.columns).toEqual(['name', 'sql'])
    const tableNames = result.rows.map((r: unknown[]) => r[0])
    expect(tableNames).toContain('items')
  })

  it('returns correct shape with columns + rows', async () => {
    const stub = getStub()
    const result = await (stub as any).query(
      'SELECT name, value FROM items WHERE id = 2',
    )

    expect(result).toHaveProperty('columns')
    expect(result).toHaveProperty('rows')
    expect(result.columns).toEqual(['name', 'value'])
    expect(result.rows).toEqual([['beta', 'two']])
  })

  it('handles empty result set', async () => {
    const stub = getStub()
    const result = await (stub as any).query(
      'SELECT * FROM items WHERE id = 999',
    )

    expect(result.columns).toEqual(['id', 'name', 'value'])
    expect(result.rows).toEqual([])
  })

  it('rejects invalid SQL with error', async () => {
    const stub = getStub()
    try {
      await (stub as any).query('SELECT * FROM nonexistent_table')
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeDefined()
    }
  })

  it('handles aggregate queries', async () => {
    const stub = getStub()
    const result = await (stub as any).query('SELECT count(*) FROM items')

    expect(result.rows[0][0]).toBe(3)
  })
})
