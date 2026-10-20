# http-sql 0.0.2

An HTTP wire format for submitting a SQL statement and receiving a result set.

**Status:** 0.0.2, a thinking-stage draft. Nothing here is settled; expect the shape to move.
**Editor:** [@rafters-studio](https://github.com/rafters-studio)
**License:** MIT

## 1. Conventions

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

All examples are illustrative. The normative content is the prose.

## 2. Endpoint

A server that follows this spec MUST expose at least one HTTP endpoint URL that accepts SQL statements per this spec. The endpoint URL is server-defined; clients receive it as configuration.

Servers MAY expose multiple endpoint URLs (for example, one per database). The wire format at each endpoint MUST be identical.

The endpoint MUST accept:

- HTTP method: `POST`
- Request `Content-Type`: `application/http-sql+json` or `application/json`
- Response `Content-Type`: `application/http-sql+json`

`application/http-sql+json` is the http-sql media type. Its body is the JSON defined in sections 4, 6, and 7; the `+json` suffix ([RFC 6839](https://www.rfc-editor.org/rfc/rfc6839)) means any JSON tool can read it. Servers MUST also accept plain `application/json` on requests, so a `curl -H 'Content-Type: application/json'` keeps working; the two are interchangeable on the request side and servers MUST NOT treat them differently. Responses use `application/http-sql+json` so a client can tell an http-sql envelope from any other JSON.

A request whose `Content-Type` media type is neither of the two above MUST be rejected with the response defined in section 7 with `error.code` of `unsupported_media_type` and HTTP status `415`. Only the media type is significant: servers MUST ignore parameters such as `charset`, so `application/json; charset=utf-8` is accepted.

The endpoint MAY accept other methods (e.g. `OPTIONS` for CORS preflight) but their semantics are out of scope, with one exception defined in section 2.1.

### 2.1 QUERY (optional read binding)

[RFC 10008](https://www.rfc-editor.org/rfc/rfc10008) defines the HTTP `QUERY` method: safe, idempotent, and cacheable like `GET`, with a request body like `POST`. A server MAY accept `QUERY` at the endpoint. When it does:

- The request body, `Content-Type` rules, and response envelopes are exactly those of `POST`. A server MUST execute a `QUERY` request the same way it executes the same body sent as `POST`; it MUST NOT parse or classify the SQL to decide.
- The server SHOULD emit `Accept-Query: application/http-sql+json` on responses from the endpoint (any method), so a client can discover the binding.
- A client that sends `QUERY` promises that the statement is safe to repeat and to serve from a cache. That promise is the client's; a server is not required to check it. A client MUST NOT send a statement that writes as `QUERY`. A server MAY reject a `QUERY` whose statement it knows to write with `error.code` of `not_allowed`.

Why a client would bother: a read sent as `QUERY` may be retried by any HTTP layer after a connection failure without a spec-level idempotency key, and the SQL stays out of URL logs. Caches keyed on request content (RFC 10008 section 2.2) may serve it. Note, non-normative: as of 2026 the major CDNs and the Cloudflare Workers Cache API cache `GET` only, and browsers send a CORS preflight for `QUERY`, so the caching benefit is prospective. A server that wants cache hits today MAY answer a `QUERY` with `303 See Other` and a `Location` that a plain `GET` can repeat, per RFC 10008 section 2.3.

`POST` remains the only required method. A server that ignores this section still follows the spec in full.

## 3. Authentication

http-sql does not mandate an authentication scheme. Servers SHOULD use a standard HTTP authentication header. The RECOMMENDED scheme is `Authorization: Bearer <token>`.

Authentication failures MUST return the response defined in section 7 with `error.code` of `auth_error` and HTTP status `401`.

## 4. Request shapes

A request body MUST be a JSON object containing exactly one of a `sql` field (single statement, section 4.1), a `batch` field (multiple statements, section 4.2), or a `describe` field (a table's shape, section 4.3). A request containing more than one of them, or none, MUST be rejected with `error.code` of `bad_request` and HTTP status `400`.

The `describe` shape is OPTIONAL for servers (section 10.1). A server that does not implement it MUST treat a `describe` request as a request containing none of the three fields, and so reject it with `bad_request` and `400`.

### 4.1 Single statement

```json
{
  "sql": "SELECT id, body FROM notes WHERE tenant_id = ?",
  "params": ["alice"]
}
```

- `sql` (REQUIRED, string) — the SQL statement.
- `params` (OPTIONAL, array) — positional parameters, in the order of the positional placeholders in `sql`. Defaults to `[]`.

The placeholder syntax itself is the server's, not this spec's: http-sql does not parse or rewrite `sql`, so the client MUST write placeholders in the syntax its target server accepts. (Non-normative: `?` in SQLite and MySQL, `$1` in PostgreSQL. The examples in this document use `?`.)

### 4.2 Batch

```json
{
  "batch": [
    {"sql": "INSERT INTO notes (id, body) VALUES (?, ?)", "params": ["1", "first"]},
    {"sql": "INSERT INTO notes (id, body) VALUES (?, ?)", "params": ["2", "second"]}
  ],
  "atomic": true
}
```

- `batch` (REQUIRED, array of statement objects) — each element MUST contain `sql` and MAY contain `params`, with the same semantics as section 4.1.
- `atomic` (OPTIONAL, boolean, default `false`) — when `true`, the server MUST execute all statements in a single transaction. Either all succeed and the transaction commits, or any failure rolls back the entire batch.

Servers MAY reject batches that exceed a server-defined statement count with HTTP status `413` and `error.code` of `payload_too_large`.

> **Non-normative note (not part of the normative contract).** The `atomic` obligation above is
> one-directional, and this spec states that asymmetry deliberately rather than by oversight.
>
> There is no way to decline within the spec. The obligation on `atomic: true` is unqualified
> here and in section 10.1, and section 7 registers no code meaning "atomicity unavailable."
> A server that cannot execute batches transactionally simply does not meet the spec for batch. Even if such a server declined with a `vendor:` code, the signal would not travel:
> section 7 directs clients to treat unknown codes as the closest registered code by HTTP
> status family, which collapses the decline into ordinary `bad_request` / `sql_error`
> semantics.
>
> There is also no way to confirm. Section 6.2's batch success envelope carries no atomicity
> field and section 9 defines no atomicity header, so a `200` is shape-identical whether or
> not the batch ran in a transaction. A client that sent `atomic: true` cannot verify the
> obligation was met, and a client whose correctness would depend on that confirmation is
> better designed as if no transaction exists.
>
> Three candidate shapes for closing the gap in a future version — a registered
> `not_supported` code, an `atomic` echo field in the section 6.2 envelope, and capability
> advertisement — are recorded in
> [issue #13](https://github.com/rafters-studio/http-sql/issues/13) and are deliberately out
> of scope for this version.

### 4.3 Describe

```json
{
  "describe": "notes"
}
```

- `describe` (REQUIRED, string) — the name of a table, as the database's catalogue records it. It is a name, not SQL: the server MUST NOT execute it, and a server that builds a catalogue query from it MUST bind it as a parameter or quote it as an identifier.

A describe request asks the server for the shape of one table: its columns, their declared types, and its primary key. The server answers from its own catalogue (in SQLite, `PRAGMA table_info`; in PostgreSQL, `information_schema` or `pg_catalog`; whatever its engine keeps), so the client sends no engine-specific SQL and needs no permission to run catalogue statements. A server that refuses `PRAGMA` or reads of its system tables under its own policy (section 12.1) can still answer `describe`.

A describe request carries no `params` and no `atomic`. It MUST NOT appear as an element of a `batch`; a batch element is a statement object (section 4.2).

If the table does not exist, or exists but the token cannot see it, the server MUST return the error envelope (section 7) with `error.code` of `permission_error` and HTTP status `403`. The server MUST return the same response in both cases, so that `describe` does not tell a caller whether a table it cannot see exists. A client therefore cannot tell a missing table from a hidden one, and MUST NOT conclude from this error that the table is absent.

## 5. Parameter types

Positional parameters use JSON values. Each JSON value MUST be bound as the server's corresponding SQL type:

| JSON value         | Bound as                 |
|--------------------|--------------------------|
| string             | the server's text type    |
| integer number     | the server's integer type |
| floating-point     | the server's real type    |
| boolean            | the server's boolean type |
| null               | SQL `NULL`                |

The type names above are semantic, not literal SQL type names; each server maps them onto its own type system. Where a server's engine lacks one of these types natively, how it represents the value is an implementation detail of that server — for example, SQLite has no boolean type, so SQLite-backed servers store booleans as `1` and `0`. Servers MUST NOT assume any particular engine's type system on the client's behalf.

For values that cannot be represented as a JSON primitive (binary blobs, integers outside JS-safe range, dates as strings of a specific format), a **tagged value** is used:

```json
{"$type": "blob",   "$value": "SGVsbG8gd29ybGQ="}
{"$type": "bigint", "$value": "9007199254740993"}
```

- `$type` (REQUIRED, string) — one of the registered types listed below, or a vendor-namespaced type (`vendor:<name>`).
- `$value` (REQUIRED) — the encoded value as a JSON value.

Registered types in this draft:

| `$type`  | `$value` encoding                                      |
|----------|--------------------------------------------------------|
| `blob`   | base64-encoded string ([RFC 4648](https://www.rfc-editor.org/rfc/rfc4648))      |
| `bigint` | decimal integer encoded as a JSON string               |

Servers MUST accept the registered types. Servers MAY accept vendor-namespaced types and MUST reject unknown types with `bad_request`.

## 6. Successful responses

### 6.1 Single statement

HTTP status: `200`.

```json
{
  "columns": ["id", "body"],
  "rows": [
    ["a-uuid", "first note"],
    ["b-uuid", "second note"]
  ],
  "rowsAffected": 0,
  "lastInsertId": null
}
```

- `columns` (REQUIRED, array of strings) — the column names of the result, in the order produced by the SQL engine. Empty array for statements that produce no result set (INSERT, UPDATE, DELETE, DDL). A SELECT produces a result set even when it matches no rows: `columns` MUST then carry the column names of that result set, and `rows` is empty. A client learns the shape of an empty result from `columns` alone.
- `rows` (REQUIRED, array of arrays) — each inner array has the same length as `columns`, with values in column order. Values use the same JSON / tagged-value encoding as section 5, subject to the emission rules below. Empty array if no rows.
- `rowsAffected` (REQUIRED, integer) — the number of rows changed by the statement. `0` for SELECT.
- `lastInsertId` (OPTIONAL, string or null) — the identifier of the most recently inserted row when the server can determine it (typically the auto-increment id). Always a string, never a JSON number: when the identifier is an integer it is encoded as a decimal string, consistent with the `bigint` encoding in section 5, so 64-bit ids survive clients whose numbers are IEEE-754 doubles. Text identifiers (a UUID primary key, say) are carried as-is. `null` when not applicable or not available.

#### Response value encoding

These rules are keyed on the **stored** value the statement produced, not on whatever runtime type the server's database driver handed back for it.

The **JSON-safe integer range** is -(2^53 - 1) through 2^53 - 1 inclusive.

- A server MUST emit an integer outside the JSON-safe integer range as `{"$type": "bigint", "$value": "<decimal digits>"}`.
- A server MUST emit a binary value as `{"$type": "blob", "$value": "<base64>"}`.
- A server MUST NOT substitute a lossy representation — a rounded number, a truncated integer, a re-formatted string that does not decode to the stored value — for the tagged form.
- A server MAY emit the tagged form for any value it could also emit as a JSON primitive, including integers inside the JSON-safe range.
- A server SHOULD emit values that are exactly representable as JSON primitives as JSON primitives.

The same rules apply to the `rows` of every `results` entry in section 6.2.

Note, non-normative: this is a constraint on the whole server, not only on its encoding layer. A driver that returns a 64-bit integer as a double has already destroyed the value before any encoding step runs, so passing here is decided by how the database is queried, not by how the result is serialized.

The arrays-of-arrays shape (not arrays-of-objects) is normative. It keeps payloads compact, makes column order explicit, and supports duplicate column names from joins.

### 6.2 Batch

HTTP status: `200`.

```json
{
  "results": [
    {"columns": [], "rows": [], "rowsAffected": 1, "lastInsertId": "1"},
    {"columns": [], "rows": [], "rowsAffected": 1, "lastInsertId": "2"}
  ]
}
```

- `results` (REQUIRED, array of single-statement result objects) — in the same order as the request `batch`. Each element has the shape of section 6.1.

A `results` array MUST have the same length as the request `batch`. A server MUST NOT return status `200` with a `results` array covering only some of the submitted statements.

#### 6.2.1 Batch failure

If a statement in a batch fails, the response is the error envelope in section 7, not a partial `results` array. This holds for both atomic and non-atomic batches.

Servers MUST execute the statements of a non-atomic batch one at a time, in `batch` array order, and MUST stop at the first statement that fails. Without this, `error.statementIndex` does not partition the batch: a server that executed statements concurrently could commit a later statement while an earlier one failed, and the client could conclude nothing about what persisted. Atomic batches carry no ordering obligation, because the transaction makes execution order unobservable.

Given that, the two cases differ in what persists, and the difference is normative:

- **Atomic batch** (`atomic: true`) — the transaction rolls back. No statement in the batch has any effect.
- **Non-atomic batch** (`atomic` absent or `false`) — statements preceding the failing statement have been executed and their effects persist. The failing statement and all statements after it have not been executed. Clients MUST NOT treat a non-atomic batch error as no-statements-applied.

For a non-atomic batch failure the server MUST include `error.statementIndex` (section 7), because it is the only means by which a client can determine how far the batch got. No such obligation applies to an atomic batch failure: nothing persisted, so there is nothing for the client to locate.

### 6.3 Describe

HTTP status: `200`.

```json
{
  "columns": [
    {"name": "id",        "type": "INTEGER", "key": 1},
    {"name": "tenant_id", "type": "TEXT",    "key": 0},
    {"name": "body",      "type": null,      "key": 0}
  ],
  "generatedKey": true
}
```

- `columns` (REQUIRED, array of column objects) — every column of the table, in declared order (the order of the table's definition, which is the order `SELECT *` produces). Each column object has:
  - `name` (REQUIRED, string) — the column name.
  - `type` (REQUIRED, string or null) — the column's declared type, as written in the table's definition or as the catalogue records it where the engine normalizes the spelling (for example `INTEGER`, `varchar(255)`, `timestamp with time zone`). Servers MUST NOT map it onto another type system, including the semantic types of section 5. `null` when the column was declared without a type, which SQLite permits.
  - `key` (REQUIRED, integer) — the column's 1-based position in the table's primary key, or `0` when the column is not part of it. A single-column key has one column with `key` of `1`; a composite key numbers its columns `1`, `2`, and on, in the key's declared order, which need not match column order.
- `generatedKey` (REQUIRED, boolean) — `true` when the database itself hands out the primary key value of a row inserted without one, `false` otherwise. Examples, non-normative: SQLite's `INTEGER PRIMARY KEY`, which aliases the rowid; PostgreSQL's `serial` and identity columns; MySQL's `AUTO_INCREMENT`. A table with no primary key column has every `key` at `0` and `generatedKey` of `false`.

The column objects carry exactly these fields at this draft. Servers MAY add vendor-namespaced fields (`vendor:<name>`) to a column object or to the response; clients MUST ignore fields they do not recognize.

## 7. Error responses

HTTP status: `4xx` or `5xx`.

```json
{
  "error": {
    "code": "sql_error",
    "message": "syntax error near 'FRMO'",
    "statementIndex": 0
  }
}
```

- `error.code` (REQUIRED, string) — one of the registered codes below, or a vendor-namespaced code (`vendor:<name>`).
- `error.message` (REQUIRED, string) — human-readable explanation. Servers SHOULD avoid leaking sensitive details.
- `error.statementIndex` (REQUIRED for non-atomic batch statement failures, otherwise OPTIONAL, integer) — the zero-based index of the statement that failed. For a non-atomic batch failure it is the client's only means of determining which statements persisted (section 6.2.1), so it MUST be present. MUST be omitted for single-statement requests.

Registered error codes in this draft:

| `code`                   | HTTP | Meaning                                                         |
|--------------------------|------|-----------------------------------------------------------------|
| `bad_request`            | 400  | Request body shape is invalid.                                  |
| `sql_error`              | 400  | The SQL is invalid or failed at runtime.                        |
| `not_allowed`            | 400  | Statement shape is rejected by server policy.                   |
| `auth_error`             | 401  | Missing or invalid credentials.                                 |
| `permission_error`       | 403  | Authenticated but not permitted to run the statement, or to describe the named table (section 4.3). |
| `payload_too_large`      | 413  | Request body or result set exceeds a server limit.              |
| `unsupported_media_type` | 415  | Request `Content-Type` media type is not `application/json`.    |
| `rate_limited`           | 429  | Too many requests.                                              |
| `internal_error`         | 500  | Server malfunction.                                             |

`unsupported_media_type` was added in the second draft (formerly numbered 0.2); a server still on the first draft does not send it.

Vendor codes carry the prefix `vendor:` (e.g. `vendor:cf_d1_quota_exceeded`). Clients SHOULD treat unknown `error.code` values as if they were the closest registered code by HTTP status family.

## 8. Pagination

This draft does not define pagination. Servers SHOULD enforce a server-defined maximum result row count and return `payload_too_large` if exceeded, with `error.message` suggesting `LIMIT` / `OFFSET` in the SQL. Cursor-based pagination is being considered for a future revision.

## 9. Version negotiation

Servers MUST include the response header:

```
Http-Sql-Version: 0.0.2
```

on every response (including error responses). Until `1.0` servers SHOULD also send the old name, `X-Http-Sql-Version`, with the same value, so existing clients keep working; the `X-` form is deprecated and will not be sent by `1.0` servers. [RFC 6648](https://www.rfc-editor.org/rfc/rfc6648) deprecates the `X-` prefix for new header fields.

Clients MAY send the request header:

```
Http-Sql-Accept-Version: 0.0.2
```

to indicate the maximum spec version they understand. Servers MAY use this for forward-compatible behavior and MUST accept the deprecated `X-Http-Sql-Accept-Version` as a synonym until `1.0`. Servers at this draft ignore the header.

## 10. What a server and a client must do

### 10.1 Servers

A server at this draft MUST:

1. Accept POST requests with `Content-Type: application/http-sql+json` or `application/json` at one or more endpoint URLs, respond with `application/http-sql+json`, and reject other media types per section 2.
2. Accept both single-statement (section 4.1) and batch (section 4.2) request shapes.
3. Return the success envelopes defined in section 6 for successful execution.
4. Return the error envelope defined in section 7 for any failure, using the HTTP status codes in the table.
5. Honor `atomic: true` on batch requests.
6. Execute a non-atomic batch sequentially in array order, stopping at the first failure (section 6.2.1).
7. On a batch statement failure, return the error envelope rather than a partial `results` array, and include `error.statementIndex` when the batch was non-atomic (section 6.2.1).
8. Accept the registered parameter types in section 5 (`blob`, `bigint`).
9. Emit the `Http-Sql-Version` response header (section 9).

A server at this draft MAY:

- Accept additional vendor-namespaced parameter types or error codes.
- Accept the `QUERY` method as a read binding (section 2.1) and advertise it with `Accept-Query`.
- Implement the `describe` request (section 4.3). A server that implements it MUST answer with the envelope in section 6.3, and with `permission_error` for a table it will not describe. A server that does not implement it MUST reject it with `bad_request` and `400`, as section 4 requires.
- Apply tenancy, ACLs, row-level security, query whitelisting, or any other policy. http-sql is transport, not policy.

### 10.2 Clients

A client at this draft MUST:

1. Send `Content-Type: application/json`.
2. Send exactly one of `sql`, `batch`, or `describe` in the request body.
3. Use the standard parameter encoding from section 5.
4. Handle the success and error envelopes from sections 6 and 7.
5. On a non-atomic batch error, treat the statements preceding `error.statementIndex` as applied (section 6.2.1). A client MUST NOT assume no statements were applied.
6. Not require any vendor-specific request or response fields beyond those defined here.
7. Not assume a server implements `describe` (section 4.3). A `bad_request` in answer to a well-formed `describe` request means the server does not implement it; the client then has no shape from that server and MUST NOT treat the error as an empty table.

A client at this draft SHOULD:

- Send the `Http-Sql-Accept-Version` header.
- Treat `error.code` values it does not recognize as the closest registered code by HTTP status family.

## 11. Versioning policy

This spec is at `0.0.2`. The first two drafts were numbered `0.1` and `0.2` before the spec had earned a number; that was premature, and the count restarted. Numbers below `0.1` mean thinking-stage: any part of the wire format may change, and no server or client should pin to it.

From here: `<major>.<minor>.<patch>`. While the major is `0`, the patch increments on any edit to the draft, the minor increments when the shape has been dogfooded by a second, independent implementation, and `1.0` is the first number a server may build a product on. After `1.0`, breaking changes increment the major, additive changes (new optional fields, new registered types, new registered error codes) increment the minor, and editorial fixes increment the patch.

### Version history

- **0.0.2** — optional `describe` request (section 4.3) and its response (section 6.3), so a client can learn a table's columns, declared types and primary key from any server that implements it without sending engine-specific SQL; a `describe` naming a table that does not exist or that the token cannot see answers `permission_error` (403), one response for both; section 6.1 now states that `columns` is REQUIRED for a SELECT that returns no rows. Additive to 0.0.1: a server that declines `describe` needs only to send the new version header and to fill `columns` on an empty SELECT.
- **0.0.1** — the count restarted at thinking-stage. Edits in this draft: `application/http-sql+json` defined as the http-sql media type, with `application/json` accepted as a request alias (section 2); optional `QUERY` read binding with `Accept-Query` discovery (section 2.1); version headers renamed `Http-Sql-Version` / `Http-Sql-Accept-Version`, `X-` forms deprecated per RFC 6648 (section 9); recommended server policy added as non-normative section 12.1; IANA intent stated (section 13). All additive to the previous draft: a server that adds the two new response headers and accepts the new request media type needs nothing else.
- **formerly 0.2** — batch failure behavior made normative (sequential non-atomic execution, `statementIndex` REQUIRED on non-atomic statement failures, preceding statements persist); response-side tagged-value emission MUSTs; `unsupported_media_type` registered (415); `lastInsertId` narrowed to string-or-null; `atomic` obligation unconditional; dialect-neutral parameter typing; `X-Http-Sql-Version` MUST.
- **formerly 0.1** — initial draft.

## 12. Security considerations

http-sql carries arbitrary SQL strings. Servers MUST treat the SQL as untrusted input from the perspective of authorization, even if the network channel is authenticated. Practical implications:

- A bearer token authenticates the caller but does not authorize arbitrary SQL. Servers SHOULD reject or rewrite statements that violate policy (tenancy, ACLs, allowlists) before execution.
- SQL parameters are passed positionally and SHOULD be bound to prepared statements server-side. Servers MUST NOT interpolate parameters into the SQL string before binding.
- Servers SHOULD enforce statement timeouts, result size limits, and rate limiting independent of the wire format.
- A `describe` response (section 4.3) discloses a table's shape. A server SHOULD answer `describe` only for tables the token could also read with a SELECT, and MUST give the same `permission_error` response for a table that is hidden from the token as for one that does not exist.
- A `QUERY` request (section 2.1) asserts to caches and intermediaries that the response is safe to reuse. A server that cannot tell whether a statement writes SHOULD treat that assertion as the client's responsibility and MUST NOT weaken its own authorization because the method was `QUERY`.

The spec does not define encryption-at-rest or transport security. Implementations SHOULD use HTTPS.

### 12.1 Recommended server policy (non-normative)

Most database vendors chose schema-mapped endpoints over raw SQL on the grounds that SQL from an HTTP client is a liability. http-sql is transport, not policy, so the answer lives in the server. A server that wants to expose http-sql to untrusted callers and stay sane needs no new protocol, only these ordinary controls, each of which is one of the registered error codes when it fires:

| Control | How | Error when refused |
|---|---|---|
| One database per token | Bind the bearer token to exactly one database (a per-tenant SQLite, a schema, a role). The SQL cannot name anything the token does not own, because nothing else is reachable. | `permission_error` (403) |
| Least-privilege database role | Run the statement as a role that can only do what the token is for: read-only tokens get a read-only role, never superuser. | `permission_error` (403) |
| Read-only mode | For read tokens, execute inside a read-only transaction or a connection opened read-only, so a write fails in the engine rather than in a SQL parser you had to write. | `not_allowed` (400) |
| Statement allowlist | Where the client is your own code, accept only known statement texts (or hashes) and bind parameters; reject everything else. | `not_allowed` (400) |
| Limits | Statement timeout, maximum rows, maximum body size, requests per second per token. | `payload_too_large` (413), `rate_limited` (429) |
| No sniffing | Reject a missing or wrong `Content-Type` before reading the body (section 2). | `unsupported_media_type` (415) |

The pattern is that the engine enforces policy, not a parser in front of it. A server that rewrites SQL to add tenancy predicates is doing something http-sql does not ask for and cannot verify; a per-tenant database or role achieves the same isolation with nothing to get wrong.

## 13. IANA considerations

This version defines the media type `application/http-sql+json` (section 2) and uses it unregistered, the same practice as `application/graphql-response+json` in the GraphQL-over-HTTP draft. The editors intend to register it in the standards tree ([RFC 6838](https://www.rfc-editor.org/rfc/rfc6838) section 3.1) when this specification is submitted as an RFC. It will not be registered in the vendor tree (`vnd.`), because the name of a vendor-neutral format should not carry a vendor.

Considered and declined: a direct binding using `application/sql` ([RFC 6922](https://www.rfc-editor.org/rfc/rfc6922)), carrying a bare statement with no envelope. It cannot carry parameters, which section 12 says SHOULD be bound rather than interpolated, and it would be a second request shape in a format whose value is having one.

A well-known URI suffix may be defined in a future revision.
