# cloudflare-durable-object

Each tenant is its own real SQLite database at the edge. http-sql v0.1 in front, Cloudflare Durable Objects with [SQLite-backed storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/) underneath.

## The shape

```
+-------------+         +---------------------+         +-----------------------------------+
| any client  |  HTTPS  |  Worker (Hono)      |  RPC    |  TenantDO (Alice)                  |
| http-sql    |-------> |  - bearer -> tenant |-------> |  - ctx.storage.sql                 |
| v0.1        |         |  - route to DO      |         |  - real SQLite, alice's data only  |
+-------------+         +---------------------+   |     +-----------------------------------+
                                                  |
                                                  |     +-----------------------------------+
                                                  +---> |  TenantDO (Bob)                    |
                                                        |  - ctx.storage.sql                 |
                                                        |  - real SQLite, bob's data only    |
                                                        +-----------------------------------+
```

- **Worker** is a thin router. Auth + tenant resolution, forward the original request to the right DO.
- **Each tenant maps to one DO instance** via `idFromName(tenant)`. That DO holds the tenant's entire database.
- **Each DO has its own SQLite** via `ctx.storage.sql`. Not row-partitioned, not shared -- a real, isolated SQLite per tenant.

## Why this is the flagship http-sql example

It is the cleanest dogfood for "SQLite on the client, SQLite on the server, content-hash diff between them." There is no fence rewriting SQL, no subquery wrap pretending a shared table is private. Each tenant's data lives in a dedicated SQLite at the edge, and any sync engine speaking http-sql (including the smugglr `http-sql` profile) operates against it the same way it would operate against a desktop SQLite file.

Other nice properties this shape buys you for free:

- **Per-tenant serialization.** Durable Objects are single-threaded actors. All writes for a given tenant are naturally ordered. No race conditions, no concurrent-writer conflict math beyond what SQLite already does.
- **Per-tenant locality.** A DO instance lives on a single Cloudflare data center. All access for that tenant routes there, so the SQLite reads are local-disk fast, not network-round-trip fast.
- **No shared-DB scale ceiling.** Adding tenants adds DOs, not load on a single backing database. The cost scales linearly with active tenants instead of pinging off a shared-resource cap.

## Setup

```sh
pnpm install
npx wrangler deploy
```

Wrangler prints the deployed URL, e.g. `https://http-sql-do.<your-subdomain>.workers.dev`.

The example's `wrangler.toml` ships two demo tokens (`TENANT_TOKEN_ALICE`, `TENANT_TOKEN_BOB`) as plain `[vars]` so you can try it without setting up secrets. In production, replace this with Hono's JWT/JWKS middleware and derive the tenant from token claims.

## Try it

```sh
ENDPOINT="https://http-sql-do.<your-subdomain>.workers.dev/sql"
ALICE="alice-dev-token"
BOB="bob-dev-token"

# Alice creates a table in HER SQLite
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALICE" \
  -d '{"sql": "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)"}'

# Alice inserts
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALICE" \
  -d '{"sql": "INSERT INTO notes VALUES (?, ?)", "params": ["1", "hello from alice"]}'

# Bob's SQLite doesn't have alice's table at all -- they are different databases
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOB" \
  -d '{"sql": "SELECT * FROM notes"}'
# -> 400 sql_error: no such table: notes
```

This is the point: Bob isn't filtered out of Alice's table -- the table genuinely doesn't exist in Bob's database. Each tenant is its own SQLite.

## What the Worker does

| Concern              | Implementation                                                            |
|----------------------|---------------------------------------------------------------------------|
| Auth                 | Bearer token -> tenant id via Hono middleware (swap for JWT in production). |
| Tenant routing       | `env.TENANT_DO.idFromName(tenant)` -> stub -> forward request.              |
| Request validation   | The DO itself validates the http-sql envelope (single/batch shape).         |
| SQL execution        | `ctx.storage.sql.exec(sql, ...params)` against the DO's own SQLite.         |
| Atomic batches       | `ctx.storage.transactionSync(() => batch.map(...))`.                        |
| Tagged params/values | `blob` (base64 <-> `Uint8Array`), `bigint` (string <-> `BigInt`).           |
| Version header       | `X-Http-Sql-Version: 0.1` on every response.                                |

## What this Worker does NOT do (yet)

- **WebSocket fan-out for live sync.** The DO already holds the perfect spot for it: after a successful write, broadcast a `{type:"changed"}` message to every connected websocket for the same tenant. Connected browsers wake up and pull. That's how you get "tab A's INSERT shows up in tab B without polling." Skipped in v1 to keep the example focused; ~30 lines to add.
- **JWT verification.** Hono has `hono/jwt` and works with JWKS-based verification too. The demo uses a hardcoded token map for clarity.
- **Multi-database per tenant.** This example assumes one SQLite per tenant. If you want multiple logical databases per tenant, route on `/sql/:db` or include `db` in the token claims.
- **Migrations across DOs.** Schema changes need to fan out across every DO instance. You can do this lazily (first request after a deploy runs `CREATE TABLE IF NOT EXISTS` etc.) or eagerly (a job iterates the tenant directory).

## See also

- [`../cloudflare-worker-to-d1/`](../cloudflare-worker-to-d1) -- the same http-sql wire format, backed by a shared D1 database instead of per-tenant DOs. Useful when you want one database to query across tenants for ops or analytics; less of a perfect fit for the smugglr sync model but a simpler operational story.
- [`../reference-server.ts`](../reference-server.ts) -- the dependency-free reference handler showing the wire format with nothing else attached.
