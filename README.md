# durable-objects-mcp

Unofficial MCP server for querying Cloudflare Durable Object SQLite storage from AI clients (Claude Code, Cursor, Windsurf, etc.).

## 🤔 Why

While building [Spawnbase](https://spawnbase.ai) we realized how painful it is to query Durable Object storage in production. So we built this.

Durable Objects store state in private SQLite databases. No REST API, no CLI, no programmatic access. The only option is [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/) — manual and dashboard-only.

And who would want to manually query thousands (millions?) of DOs manually, when we've got Claude Code and the like?

This MCP server gives AI clients structured, read-only access to your DO storage. Connect once, discover tables, run queries.

> TODO: The best version of this tool is one that doesn't need to exist. We'd love Cloudflare to ship native secure query access for DO storage.
> Until then, this fills the gap.

## ⚙️ What it enables

```
You (while sipping coffee): "What tables does the AIAgent DO have for user abc123?"

→ describe_schema({ class_name: "AIAgent", name: "abc123" })

  _cf_KV           — key TEXT, value BLOB
  cf_agents_state  — id TEXT, data BLOB
  cf_agents_messages — id TEXT, role TEXT, content TEXT, created_at INTEGER
  ...

You (after the second sip): "Show me the last 5 messages"

→ query({ class_name: "AIAgent", name: "abc123",
          sql: "SELECT role, content FROM cf_agents_messages ORDER BY created_at DESC LIMIT 5" })

  role       | content
  -----------|----------------------------------
  user       | Deploy the workflow to production
  assistant  | I'll deploy workflow wf_a8c3...
  ...
```

A standalone Cloudflare Worker that binds to your DO namespaces via `script_name` and calls a `query()` RPC method on each DO instance. Auth via Cloudflare Access (OAuth).

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
