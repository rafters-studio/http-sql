# cloudflare-worker-to-d1

A Cloudflare Worker that gives any D1 database an http-sql v0.1 endpoint.

POST http-sql requests to this Worker; it translates to D1 binding calls and returns http-sql responses. Built on [Hono](https://hono.dev) so the auth, CORS, and routing layers come from well-known middleware instead of being hand-rolled.

## Why this exists

The fastest way to understand what http-sql means in practice. Bring your own D1, deploy the Worker, and you have a conforming http-sql server. Point any http-sql client at it -- including the [reference client](../reference-client.ts) or the smugglr `http-sql` profile -- and it just works.

This is also the proof that http-sql is implementable in a small amount of code on top of an existing SQL backend. If it takes 150 lines for D1, it takes roughly that much for Turso, rqlite, libSQL, or sqlite3-in-a-Node-server.

## Setup

```sh
npx wrangler d1 create my_database
```

Paste the printed `database_id` into `wrangler.toml`.

```sh
pnpm install
npx wrangler secret put HTTP_SQL_TOKEN
# enter the bearer token you want to require on every request
npx wrangler deploy
```

Wrangler prints the deployed URL, e.g. `https://http-sql-d1.<your-subdomain>.workers.dev`.

## Try it

```sh
ENDPOINT="https://http-sql-d1.<your-subdomain>.workers.dev"
TOKEN="<the token you set above>"

# Create a table
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sql": "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT)"}'

# Insert
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sql": "INSERT INTO notes (id, body) VALUES (?, ?)", "params": ["1", "hello"]}'

# Select
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sql": "SELECT id, body FROM notes"}'
```

Response to the SELECT:

```json
{
  "columns": ["id", "body"],
  "rows": [["1", "hello"]],
  "rowsAffected": 0,
  "lastInsertId": null
}
```

## What the Worker does

| Spec section            | Implementation note                                                                 |
|-------------------------|--------------------------------------------------------------------------------------|
| 3. Authentication       | Single shared bearer token via Workers secret. Trivial to swap for JWT/JWKS.        |
| 4.1 Single statement    | `db.prepare(sql).bind(...params).all()` after decoding tagged params.               |
| 4.2 Batch               | Atomic batches use D1's `db.batch()` (one transaction). Non-atomic runs sequentially with per-statement error reporting. |
| 5. Parameter types      | JSON primitives pass through. `{$type: "blob", ...}` decodes to `Uint8Array`. `{$type: "bigint", ...}` to a JS `BigInt`. Binary results re-encode on the way out. |
| 6. Success responses    | Columns derived from the first row's keys (D1 returns objects); rows are remapped to the spec's array-of-arrays shape. |
| 7. Error responses      | Maps validation errors to `bad_request`, missing auth to `auth_error`, runtime SQL errors to `sql_error`. |
| 9. Version negotiation  | Every response carries `X-Http-Sql-Version: 0.1`.                                   |

## What this Worker does NOT do

- **No tenancy enforcement.** Anyone with the bearer token can run any SQL against the bound D1. Add row-level scoping (e.g. inject `WHERE tenant_id = ?` derived from the auth token) if you need multi-tenancy.
- **No statement allowlisting.** A compromised token grants `DROP TABLE`. Production setups should restrict the statement surface based on the authenticated principal.
- **No rate limiting.** Use Cloudflare's built-in rate limiting or a service binding to enforce it.
- **No pagination.** Per spec section 8, large result sets should be capped via `LIMIT` / `OFFSET` in the SQL. A future http-sql revision may add cursor pagination.

## Variants worth building yourself

- **Tenant-fence variant:** add row-level scoping by authenticated tenant id, on top of this skeleton.
- **JWT variant:** replace `HTTP_SQL_TOKEN` with JWKS-based verification and derive tenant / claims from the token.
- **Multi-database variant:** route based on a path segment (`POST /db/<name>`) to one of N D1 bindings.

Each is a small delta from the code in `src/index.ts`.
