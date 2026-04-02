const ALLOWED_PREFIXES = ['SELECT', 'PRAGMA', 'EXPLAIN', 'WITH']

/**
 * Fast-fail check before SQL reaches the DO.
 * Defense in depth — the DO also sets PRAGMA query_only = ON.
 */
export function assertReadOnly(sql: string): void {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    const normalized = stmt.toUpperCase()
    const isAllowed = ALLOWED_PREFIXES.some((p) => normalized.startsWith(p))
    if (!isAllowed) {
      throw new Error(
        `Read-only: only SELECT, PRAGMA, EXPLAIN, WITH allowed. Got: ${stmt.substring(0, 50)}`,
      )
    }
  }
}
