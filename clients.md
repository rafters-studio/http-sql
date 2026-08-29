# Day-one clients

The clients we supply, in the order they ship, and the rule every one of them follows. A spec with no popular client loses to a client with no spec; this list is how http-sql gets traffic.

## The rule for every client

A client is `fetch` and JSON. It does one thing: send a statement or a batch, return the envelope, map errors. The whole contract fits in the reference client (~40 lines, `examples/reference-client.ts`), and every client below is that shape in its own language:

- `POST` (and `QUERY` where the runtime allows it) with `Content-Type: application/http-sql+json`; send `Http-Sql-Accept-Version: 0.0.1`.
- `Authorization: Bearer <token>`, supplied by the caller. The client never stores or mints a token.
- Body is `{sql, params}` or `{batch, atomic}`; params are positional JSON values with the two tagged forms (`blob` as base64, `bigint` as a decimal string).
- Return `columns`, `rows` (arrays of arrays), `rowsAffected`, `lastInsertId` as the language's natural types; decode tagged values into the language's lossless types (see the table).
- Map `error.code` to one typed error per registered code; carry `statementIndex` on non-atomic batch failures; treat an unknown `vendor:` code as the closest registered code by HTTP status family.
- No sessions, no connection objects, no retries beyond what the caller asks for, no query builder, no schema knowledge. If a feature needs the client to be smarter than that, it is a product built on http-sql, not the client.

A client is done when it passes the client cases in `checks/` against the reference server. Nothing else counts.

## Lossless types per language

The one place clients differ is what a tagged `bigint` and `blob` become. Each client decodes to the type in this table and encodes from it; a client that rounds a 64-bit integer to a double is not done.

| Language | `bigint` | `blob` | Note |
|---|---|---|---|
| TypeScript / JavaScript | `bigint` | `Uint8Array` | JSON numbers above 2^53 never appear on the wire, so `Number` stays safe for everything untagged |
| Rust | `i64` (or `i128` if a server sends past 64 bits) | `Vec<u8>` | serde untagged enum over the value shapes |
| Python | `int` | `bytes` | Python ints are arbitrary precision; the tag still matters for encoding on the way out |
| C# | `long` | `byte[]` | `System.Text.Json`; Unity needs the `UnityWebRequest` transport, not `HttpClient` |
| Go | `int64` | `[]byte` | `encoding/json` with a custom unmarshaler for the tagged forms |
| Swift | `Int64` | `Data` | `URLSession`; Codable with a custom decoder for the tagged forms |
| Kotlin | `Long` | `ByteArray` | `okhttp` or `ktor`; kotlinx.serialization |

## Tier 1: ships before anything is announced

Ordered by where http-sql traffic actually originates.

| Client | Runtime | Who it is for | Package name (proposed) | Why day one |
|---|---|---|---|---|
| TypeScript / JavaScript | Browser, Cloudflare Workers, Deno, Vercel Edge, Node, Bun | Local-first web apps, edge functions, React Native / Expo | `@http-sql/client` on npm | Where the edge-era traffic is. One package, zero dependencies, `fetch` only, so the same file runs in a browser and a Worker. The reference client grows into this. |
| Rust | Native and wasm32 | CLIs, daemons, embedded engines, the C-ABI base for game engines | `http-sql` on crates.io | smugglr's own profile is a Rust client already; a standalone crate is the one other clients bind to (C-ABI for Unreal, wasm for the browser). Ships with a tiny `http-sql` binary so a shell or an agent can run a statement without writing code. |
| Python | CPython 3.10+ | Data and analytics scripts, notebooks, agent frameworks | `http-sql` on PyPI | The second-largest source of "send SQL, get rows" traffic after JS, and the language agents are written in. `httpx` optional, `urllib` default so it installs with nothing. |
| C# | .NET Standard 2.1, Unity 2021+ | Unity games (the games segment), .NET services | `HttpSql` on NuGet, plus a Unity package (UPM) | Games are the first segment fence targets and Unity is where they are built. The Unity package uses `UnityWebRequest` and a main-thread-safe callback so it does not block the render loop. |
| Drizzle driver | TypeScript | Anyone already on Drizzle at the edge | `@http-sql/drizzle` | The adoption lever the prior-art research found: PlanetScale implemented Neon's undocumented endpoint because Neon's driver had users. A Drizzle HTTP driver (the shape of `drizzle-orm/neon-http`) makes every Drizzle app an http-sql client with one import. |
| Kysely dialect | TypeScript | Anyone already on Kysely | `@http-sql/kysely` | Same lever, second-most-used TS query builder at the edge. Small; shares the core client. |
| MCP server | Node | A customer's agent (Claude, or any MCP host) | `@http-sql/mcp` | The "customer's agent calls fence directly" persona needs a tool, not a library. One tool, `query`, with the endpoint and token from config. Thin over the TS client. |

## Tier 2: fast follow, ordered

| Client | Why not day one |
|---|---|
| Go | Real audience (infra CLIs, Go backends) but not where our first segments originate. Ships once the Tier 1 shape has settled, so it copies rather than invents. |
| Unreal (C++) | Binds the Rust crate's C-ABI rather than being written twice; waits on that ABI, which smugglr-core is defining for its own engine SDKs. Pure UE (`FHttpModule` + JSON) is a fallback if the ABI slips. |
| Swift | Native iOS and macOS apps and games not on Unity. After C#. |
| Kotlin | Native Android and JVM. After Swift, same shape. |
| Neon-driver compatibility | Not a client: a server-side adapter so the existing `@neondatabase/serverless` driver's `fetchEndpoint` works against an http-sql server. Worth having for exactly the reason Drizzle is, but it lives in a server, not here. |

## Declined for day one

PHP, Ruby, Java, Elixir. No traffic origin in the segments we serve first, and each is a community that will write its own thirty lines the day it wants one. If someone ships one, it goes in `implementations.md`.

## Where they live

`clients/<language>/` in this repo, so the spec, the checks, and every client version together and the checks runner tests all of them in one CI job. Each is published independently under the package names above. MIT, like the spec: the clients are free; what you point them at may not be.
