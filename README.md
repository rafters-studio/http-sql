# http-sql

An HTTP wire format for SQL.

POST a SQL statement and parameters to an endpoint, get rows back. Stateless, edge-friendly, JSON over HTTP. Nothing more.

**Status:** v0.1 draft. The spec is being dogfooded against working implementations before being proposed as an RFC. Breaking changes possible until v1.0.

## The problem this solves

There is no shared wire format for "send a SQL statement over HTTP, get a result set back." Every vendor invented their own:

- **Cloudflare D1**: `{"sql": "...", "params": [...]}` returning `{result: [{results: [...]}]}`
- **Turso / libSQL Hrana**: `{"requests": [{"type": "execute", "stmt": {"sql": "...", "args": [{"type": "text", "value": "..."}]}}]}` — websocket-flavored, stateful
- **rqlite**: `[["SQL", ...params]]` — positional array of arrays
- **Datasette**: `{"sql": "...", "_shape": "array"}` — read-only
- **SQLite Cloud**, **StarbaseDB**, and others — more shapes

The PostgreSQL wire protocol is a streaming socket protocol — not HTTP, not edge-friendly, not browser-callable. SQL itself is a query language, not a transport. The HTTP transport layer for SQL-over-HTTP is genuinely unstandardized, and the result is that every sync tool, ORM, and CLI that wants to target multiple backends ships a "profile" abstraction that catalogs vendor quirks instead of speaking one format.

`http-sql` is that one format.

## Goals (v0.1)

- **One canonical request/response shape** that works for SELECT, INSERT, UPDATE, DELETE, DDL, and batched statements.
- **Stateless HTTP**. No sessions, no connection objects, no websocket upgrades. One request, one response.
- **Tiny implementation cost**. A conforming server is ~50 lines; a conforming client is ~30. Mostly JSON parsing.
- **Edge-friendly**. Small payloads, no streaming, no long-lived connections. Runs on Cloudflare Workers, Deno Deploy, Vercel Edge, Lambda@Edge without contortions.
- **Vendor-neutral**. The spec doesn't mention any specific database or platform.
- **JSON-native parameters and results**. Strings, numbers, booleans, null, with a tagged form for blobs and other extended types.

## Non-goals (v0.1)

- **Streaming large result sets.** Pagination is the v0.1 answer. SSE / chunked responses can come in a later revision.
- **Cross-request transactions.** One request is one autocommit unit. Batch requests can opt into atomicity. Multi-request transactions need session state and break statelessness; out of scope.
- **Schema management primitives.** DDL is allowed as a normal SQL statement; the spec doesn't add `CREATE TABLE` helpers.
- **Authentication scheme.** Use HTTP auth headers. `Bearer` is recommended but the spec doesn't mandate.
- **SQL dialect normalization.** The server runs whatever SQL flavor it runs. The spec is transport, not parser.
- **Tenancy, ACLs, row-level security.** Server's job. The spec carries SQL; it doesn't know what's in it.

## Where to read

- [SPEC.md](./SPEC.md) — the wire format definition
- [examples/](./examples) — curl invocations, reference client and server, and two full Cloudflare implementations (D1-backed and Durable-Object-backed)
- [conformance/](./conformance) — what a server must do to claim http-sql v0.1 conformance
- [implementations.md](./implementations.md) — known servers and clients

## Prior art

The spec borrows shape from existing implementations and tries to be the simplest viable convergence:

- **D1 REST** — the closest existing shape. http-sql is essentially the D1 request format with a cleaner response envelope.
- **Hrana (libSQL/Turso)** — comprehensive but stateful and websocket-oriented. http-sql intentionally rejects statefulness as the bigger cost.
- **Datasette** — read-only, designed for exploration. http-sql is read/write but borrows the principle of "boring HTTP is the win."
- **JSON-RPC over HTTP** — http-sql is not JSON-RPC; method dispatch and id correlation are unnecessary for SQL submission and add envelope weight.

## How to contribute

Open an issue. The spec is in flight; concrete feedback against the draft is more useful than abstract redesigns. If you ship something that speaks http-sql (server or client), open a PR adding it to the implementations list — that's the dogfooding evidence the spec needs before being formalized.

## License

MIT.
