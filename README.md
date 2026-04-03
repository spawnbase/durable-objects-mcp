# 🧊 durable-objects-mcp

![Rick Rubin knows](https://github.com/user-attachments/assets/b9188499-55cb-44ad-887f-b11768b187f2)

Unofficial MCP server for querying Cloudflare Durable Object SQLite storage from AI clients (Claude Code, Cursor, Windsurf, etc.). Gives AI clients structured, read-only access to your DO storage. Connect once, discover tables, run queries.

## 🤔 Why

Durable Objects store state in private SQLite databases with no programmatic query access — just [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/) in the dashboard. We built this while working on [Spawnbase](https://spawnbase.ai) because manually clicking through thousands of DO instances isn't viable.

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

> **Warning:** Durable Objects can store sensitive data — session tokens, PII, payment records, conversation history. Before deploying, review what your DOs contain, only bind the namespaces you need, and restrict your Cloudflare Access policy accordingly. If you serve end users, make sure your terms of service cover this kind of data access.

We took security seriously when building this. Here's what we put in place:

- **Cloudflare Access (OAuth)** — all authentication happens at the edge before the request reaches the Worker. JWTs are verified against CF Access JWKS (signature, algorithm, expiry). PKCE (S256 only) is enforced on the MCP client side. Revoking a user in your identity provider cuts their MCP session on the next token refresh.
- **Read-only by design** — a server-side SQL guard rejects anything that isn't SELECT, PRAGMA, EXPLAIN, or WITH before it reaches the DO. All write statements are blocked at the MCP server level.
- **No public DO access** — the `query()` RPC call uses Cloudflare service bindings (`script_name`), which stay entirely within Cloudflare's internal network. There is no public HTTP endpoint to the DOs. The MCP server is the only way in.
- **Explicit namespace scoping** — only DO classes with bindings in `wrangler.jsonc` are discoverable and queryable. Nothing is exposed by default.

## 🛠️ Tools

| Tool              | What it does                                             |
| ----------------- | -------------------------------------------------------- |
| `list_classes`    | Lists queryable DO classes configured in your deployment |
| `describe_schema` | Returns tables and columns for a DO instance             |
| `query`           | Executes read-only SQL against a DO instance             |

## 🚀 Setup

### 1. Add a `query()` method to your DO classes

Each DO class you want to query needs this method:

```typescript
query(sql: string) {
  const cursor = this.ctx.storage.sql.exec(sql)
  return { columns: cursor.columnNames, rows: [...cursor.raw()] }
}
```

The MCP server's SQL guard blocks all non-SELECT statements before they reach the DO.

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

Any DO binding (except `DO_MCP_AGENT`) is automatically queryable — no additional config needed.

### 3. Set up auth (Cloudflare Access)

Create a [Cloudflare Access for SaaS](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/saas-mcp/) application with OIDC protocol. Set the redirect URL to `https://your-worker.workers.dev/callback`. Add a policy to control who can access.

Then set secrets:

```bash
wrangler secret put ACCESS_TEAM             # your Zero Trust team name
wrangler secret put ACCESS_CLIENT_ID        # from the SaaS app
wrangler secret put ACCESS_CLIENT_SECRET    # from the SaaS app
wrangler secret put COOKIE_ENCRYPTION_KEY   # openssl rand -hex 32
```

### 4. Deploy

```bash
wrangler deploy
```

### 5. Connect your MCP client

On first connect, you'll authenticate via Cloudflare Access (browser popup). After that, the session persists.

**Claude Code:**

```bash
claude mcp add --transport http do-explorer https://your-worker.workers.dev/mcp
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "do-explorer": { "url": "https://your-worker.workers.dev/mcp" }
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.do-explorer]
url = "https://your-worker.workers.dev/mcp"
```

Then run `codex mcp login do-explorer` to authenticate.

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "do-explorer": {
      "type": "remote",
      "url": "https://your-worker.workers.dev/mcp"
    }
  }
}
```

## 📋 Requirements

- 5 minutes
- Cloudflare Workers Paid plan
- SQLite-backed Durable Objects (compatibility date `2024-04-03`+)
- Cloudflare Zero Trust (for auth)

## 📄 License

MIT
