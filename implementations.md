# http-sql implementations

A directory of known servers and clients speaking the [http-sql v0.1 spec](./SPEC.md). The list is bootstrap-thin; PRs welcome.

## Servers

| Implementation | Form | Backend | Notes |
|----------------|------|---------|-------|
| [examples/reference-server.ts](./examples/reference-server.ts) | TypeScript handler | _swap in your own DB_ | Dependency-free reference; the wire format with nothing else attached. |
| [examples/cloudflare-worker-to-d1](./examples/cloudflare-worker-to-d1) | Cloudflare Worker (Hono) | Cloudflare D1 | Drop-in http-sql endpoint for an existing D1 database. Auth via bearer token. |
| [examples/cloudflare-durable-object](./examples/cloudflare-durable-object) | Cloudflare Worker + Durable Object (Hono) | SQLite-backed DO storage | Each tenant is its own real SQLite at the edge. The flagship dogfood for "SQLite on both sides." |

## Clients

| Implementation | Form | Notes |
|----------------|------|-------|
| [examples/reference-client.ts](./examples/reference-client.ts) | TypeScript class, ~40 lines | Uses platform `fetch`. No dependencies. |
| smugglr `http-sql` profile | Rust / WASM | _in flight; tracked in [rafters-studio/smugglr](https://github.com/rafters-studio/smugglr) -- link will land here when the profile ships._ |

## Ways into the ecosystem

The combinations above let you enter at whichever end matches what you already have:

- **You have a SQL backend, want a sync-friendly HTTP surface in front of it.** Use [cloudflare-worker-to-d1](./examples/cloudflare-worker-to-d1) as the template, swap D1 for your backend. Now any http-sql client can sync against it.
- **You want per-tenant SQLite at the edge with no infrastructure.** Use [cloudflare-durable-object](./examples/cloudflare-durable-object). Each tenant becomes its own DO with its own SQLite. Pair with [smugglr](https://github.com/rafters-studio/smugglr) in the browser for "SQLite on both sides, content-hash diff between them."
- **You're writing a sync engine, ORM, or CLI that wants to target many backends.** Implement the wire format once (the reference client is ~40 lines). Every conforming server becomes a target.

## How to add yours

1. Implement the [v0.1 spec](./SPEC.md) (or the [conformance contract](./conformance/README.md) for self-check).
2. Open a PR adding a row to the table above.
3. Include: name, form (Worker / Node / library), backend (D1 / Turso / Postgres / DO / etc), and one-line notes.

Conformance is self-asserted. The community calls out failures via issues.
