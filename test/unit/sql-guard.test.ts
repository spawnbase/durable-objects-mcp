import { describe, expect, it } from 'vitest'
import { assertReadOnly } from '../../src/sql-guard'

/**
 * sql-guard is our ONLY write protection — PRAGMA query_only
 * is not supported in CF DO SQLite.
 */

describe('assertReadOnly: allowed statements', () => {
  it('allows SELECT', () => {
    expect(() => assertReadOnly('SELECT * FROM users')).not.toThrow()
  })

  it('allows PRAGMA', () => {
    expect(() => assertReadOnly('PRAGMA table_list')).not.toThrow()
  })

  it('allows EXPLAIN', () => {
    expect(() => assertReadOnly('EXPLAIN SELECT 1')).not.toThrow()
  })

  it('allows EXPLAIN QUERY PLAN', () => {
    expect(() =>
      assertReadOnly('EXPLAIN QUERY PLAN SELECT * FROM items'),
    ).not.toThrow()
  })

  it('allows WITH (CTE)', () => {
    expect(() =>
      assertReadOnly('WITH cte AS (SELECT 1) SELECT * FROM cte'),
    ).not.toThrow()
  })

  it('allows WITH RECURSIVE', () => {
    expect(() =>
      assertReadOnly(
        'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10) SELECT x FROM cnt',
      ),
    ).not.toThrow()
  })

  it('allows SELECT with subquery', () => {
    expect(() => assertReadOnly('SELECT * FROM (SELECT 1 AS x)')).not.toThrow()
  })

  it('allows SELECT with CASE', () => {
    expect(() =>
      assertReadOnly("SELECT CASE WHEN 1=1 THEN 'yes' ELSE 'no' END"),
    ).not.toThrow()
  })

  it('allows UNION', () => {
    expect(() => assertReadOnly('SELECT 1 UNION SELECT 2')).not.toThrow()
  })

  it('is case-insensitive', () => {
    expect(() => assertReadOnly('select * from users')).not.toThrow()
    expect(() => assertReadOnly('pragma table_info(users)')).not.toThrow()
  })
})

describe('assertReadOnly: blocked statements', () => {
  it('rejects INSERT', () => {
    expect(() => assertReadOnly("INSERT INTO users VALUES ('a')")).toThrow(
      /Read-only/,
    )
  })

  it('rejects UPDATE', () => {
    expect(() => assertReadOnly("UPDATE users SET name = 'x'")).toThrow(
      /Read-only/,
    )
  })

  it('rejects DELETE', () => {
    expect(() => assertReadOnly('DELETE FROM users')).toThrow(/Read-only/)
  })

  it('rejects DROP', () => {
    expect(() => assertReadOnly('DROP TABLE users')).toThrow(/Read-only/)
  })

  it('rejects CREATE', () => {
    expect(() => assertReadOnly('CREATE TABLE x (id INTEGER)')).toThrow(
      /Read-only/,
    )
  })

  it('rejects ALTER', () => {
    expect(() => assertReadOnly('ALTER TABLE users ADD col TEXT')).toThrow(
      /Read-only/,
    )
  })

  it('rejects ATTACH DATABASE', () => {
    expect(() => assertReadOnly("ATTACH DATABASE ':memory:' AS x")).toThrow(
      /Read-only/,
    )
  })

  it('rejects DETACH DATABASE', () => {
    expect(() => assertReadOnly('DETACH DATABASE hack')).toThrow(/Read-only/)
  })

  it('rejects VACUUM', () => {
    expect(() => assertReadOnly('VACUUM')).toThrow(/Read-only/)
  })

  it('rejects REINDEX', () => {
    expect(() => assertReadOnly('REINDEX')).toThrow(/Read-only/)
  })

  it('rejects REPLACE INTO', () => {
    expect(() => assertReadOnly("REPLACE INTO items VALUES (1, 'x')")).toThrow(
      /Read-only/,
    )
  })

  it('rejects INSERT OR REPLACE', () => {
    expect(() =>
      assertReadOnly("INSERT OR REPLACE INTO items VALUES (1, 'x')"),
    ).toThrow(/Read-only/)
  })
})

describe('assertReadOnly: injection attacks', () => {
  it('blocks multi-statement injection', () => {
    expect(() => assertReadOnly('SELECT 1; DROP TABLE users')).toThrow(
      /Read-only/,
    )
  })

  it('blocks write disguised after SELECT', () => {
    expect(() =>
      assertReadOnly('SELECT 1; INSERT INTO users VALUES (1)'),
    ).toThrow(/Read-only/)
  })

  it('blocks semicolon injection with whitespace', () => {
    expect(() => assertReadOnly('SELECT 1 ;   DROP TABLE x')).toThrow(
      /Read-only/,
    )
  })

  it('blocks CREATE via multi-statement', () => {
    expect(() =>
      assertReadOnly('SELECT 1; CREATE TABLE hack (id INT)'),
    ).toThrow(/Read-only/)
  })

  it('blocks comment-based injection attempt', () => {
    expect(() => assertReadOnly('SELECT 1 -- ; DROP TABLE x')).toThrow(
      /Read-only/,
    )
  })
})

describe('assertReadOnly: edge cases', () => {
  it('handles trailing semicolons', () => {
    expect(() => assertReadOnly('SELECT 1;')).not.toThrow()
  })

  it('handles multiple semicolons', () => {
    expect(() => assertReadOnly('SELECT 1;;;')).not.toThrow()
  })

  it('handles whitespace', () => {
    expect(() => assertReadOnly('  SELECT 1  ')).not.toThrow()
  })

  it('handles only whitespace', () => {
    expect(() => assertReadOnly('   ')).not.toThrow()
  })

  it('handles empty string', () => {
    expect(() => assertReadOnly('')).not.toThrow()
  })

  it('truncates error message for long SQL', () => {
    const longSql = 'DROP ' + 'x'.repeat(200)
    try {
      assertReadOnly(longSql)
      expect.fail('Should have thrown')
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(200)
    }
  })
})
