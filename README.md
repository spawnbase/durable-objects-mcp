# durable-objects-mcp

> "The pain of querying Durable Objects in production is so great we decided to do something about it."

Unofficial MCP server for querying Cloudflare Durable Object SQLite storage from AI clients (Claude Code, Cursor, Windsurf, etc.).

## 🤔 Why

While building [Spawnbase](https://spawnbase.ai), which relies heavily on Durable Objects, the pain of needing to query production DO state was so great that we decided to do something about it.

Durable Objects store state in private SQLite databases. There is no REST API, no CLI, and no programmatic way to query this storage from outside the DO instance. The only option today is [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/) — a manual, dashboard-only UI.

This MCP server gives AI clients structured, read-only access to your DO storage. Connect once, discover tables, run queries.

> TODO: We've raised a feature request with Cloudflare for native MCP/API support for DO storage. If Cloudflare ships that, this project becomes unnecessary — and that's a good outcome.

## ⚙️ How it works

```
MCP Client ──MCP/HTTP──> durable-objects-mcp Worker ──DO binding──> DO.query(sql) ──> results
```

The MCP server is a standalone Cloudflare Worker. It binds to your DO namespaces via `script_name` in `wrangler.jsonc` and calls a `query()` RPC method on each DO instance. Auth is handled via Cloudflare Access (OAuth).

## 🔒 Security

- **Cloudflare Access (OAuth)** — auth at the edge. Unauthenticated requests never reach the Worker.
- **PRAGMA query_only** — SQLite engine rejects all write operations at the database level.
- **SQL guard** — server-side validation rejects non-SELECT statements before they reach the DO.
- **Row limit** — queries without LIMIT are capped at 100 rows.
- **Namespace allowlist** — only DO classes explicitly configured in `DO_CONFIG` are queryable.

## 🛠️ Tools

| Tool | What it does |
|------|-------------|
| `list_classes` | Lists queryable DO classes configured in your deployment |
| `describe_schema` | Returns tables and columns for a DO instance |
| `query` | Executes read-only SQL against a DO instance |

## 🚀 Setup

### 1. Add a `query()` method to your DO classes

Each DO class you want to query needs this method:

```typescript
query(sql: string) {
  this.ctx.storage.sql.exec('PRAGMA query_only = ON')
  try {
    const cursor = this.ctx.storage.sql.exec(sql)
    return { columns: cursor.columnNames, rows: [...cursor.raw()] }
  } finally {
    this.ctx.storage.sql.exec('PRAGMA query_only = OFF')
  }
}
```

`PRAGMA query_only` enforces read-only at the SQLite engine level — INSERT, UPDATE, DELETE, DROP, CREATE all throw `SQLITE_READONLY`.

### 2. Clone and configure

```bash
git clone https://github.com/spawnbase/durable-objects-mcp.git
cd durable-objects-mcp
pnpm install
```

Edit `wrangler.jsonc` — add DO bindings pointing at your Worker:

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "DO_MCP_AGENT", "class_name": "DOMcpAgent" },
    {
      "name": "AI_AGENT",
      "class_name": "AIAgent",
      "script_name": "your-worker-name"
    }
  ]
}
```

Edit `src/mcp-agent.ts` — map class names to binding keys:

```typescript
const DO_CONFIG: Record<string, string> = {
  AIAgent: 'AI_AGENT',
}
```

### 3. Set up auth (Cloudflare Access)

Create a [Cloudflare Access for SaaS](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/saas-mcp/) application. You'll need these Worker secrets:

```bash
wrangler secret put ACCESS_CLIENT_ID
wrangler secret put ACCESS_CLIENT_SECRET
wrangler secret put ACCESS_TOKEN_URL
wrangler secret put ACCESS_AUTHORIZATION_URL
wrangler secret put ACCESS_JWKS_URL
wrangler secret put COOKIE_ENCRYPTION_KEY  # openssl rand -hex 32
```

### 4. Deploy

```bash
wrangler deploy
```

### 5. Connect your MCP client

```json
{
  "mcpServers": {
    "do-explorer": {
      "url": "https://your-worker.workers.dev/mcp"
    }
  }
}
```

On first connect, you'll authenticate via Cloudflare Access. After that, the session persists.

## 📋 Requirements

- 5 minutes
- Cloudflare Workers Paid plan
- SQLite-backed Durable Objects (compatibility date `2024-04-03`+)
- Cloudflare Zero Trust (for auth)

## 📄 License

MIT
