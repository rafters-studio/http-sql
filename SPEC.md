# http-sql v0.1

An HTTP wire format for submitting a SQL statement and receiving a result set.

**Status:** Draft, v0.1.
**Editor:** [@rafters-studio](https://github.com/rafters-studio)
**License:** MIT

## 1. Conventions

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

All examples are illustrative. The normative content is the prose.

## 2. Endpoint

A conforming http-sql server MUST expose at least one HTTP endpoint URL that accepts SQL statements per this spec. The endpoint URL is server-defined; clients receive it as configuration.

Servers MAY expose multiple endpoint URLs (for example, one per database). The wire format at each endpoint MUST be identical.

The endpoint MUST accept:

- HTTP method: `POST`
- Request `Content-Type`: `application/json`
- Response `Content-Type`: `application/json`

The endpoint MAY accept other methods (e.g. `OPTIONS` for CORS preflight) but their semantics are out of scope.

## 3. Authentication

http-sql does not mandate an authentication scheme. Servers SHOULD use a standard HTTP authentication header. The RECOMMENDED scheme is `Authorization: Bearer <token>`.

Authentication failures MUST return the response defined in section 7 with `error.code` of `auth_error` and HTTP status `401`.

## 4. Request shapes

A request body MUST be a JSON object containing **either** a `sql` field (single statement) **or** a `batch` field (multiple statements), not both. A request containing both or neither MUST be rejected with `error.code` of `bad_request` and HTTP status `400`.

### 4.1 Single statement

```json
{
  "sql": "SELECT id, body FROM notes WHERE tenant_id = ?",
  "params": ["alice"]
}
```

- `sql` (REQUIRED, string) — the SQL statement.
- `params` (OPTIONAL, array) — positional parameters, in the order of `?` placeholders in `sql`. Defaults to `[]`.

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

## 5. Parameter types

Positional parameters use JSON values. The mapping to SQL types is:

| JSON value         | SQL type          |
|--------------------|-------------------|
| string             | TEXT              |
| integer number     | INTEGER           |
| floating-point     | REAL              |
| boolean            | INTEGER (1 or 0)  |
| null               | NULL              |

For values that cannot be represented as a JSON primitive (binary blobs, integers outside JS-safe range, dates as strings of a specific format), a **tagged value** is used:

```json
{"$type": "blob",   "$value": "SGVsbG8gd29ybGQ="}
{"$type": "bigint", "$value": "9007199254740993"}
```

- `$type` (REQUIRED, string) — one of the registered types listed below, or a vendor-namespaced type (`vendor:<name>`).
- `$value` (REQUIRED) — the encoded value as a JSON value.

Registered types in v0.1:

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

- `columns` (REQUIRED, array of strings) — the column names of the result, in the order produced by the SQL engine. Empty array for statements that produce no result set (INSERT, UPDATE, DELETE, DDL).
- `rows` (REQUIRED, array of arrays) — each inner array has the same length as `columns`, with values in column order. Values use the same JSON / tagged-value encoding as section 5. Empty array if no rows.
- `rowsAffected` (REQUIRED, integer) — the number of rows changed by the statement. `0` for SELECT.
- `lastInsertId` (OPTIONAL, string, number, or null) — the identifier of the most recently inserted row when the server can determine it (typically the auto-increment id). `null` when not applicable or not available.

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

If an atomic batch fails partway through, the response is the error envelope in section 7, not a partial `results` array.

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
- `error.statementIndex` (OPTIONAL, integer) — for batch requests, the zero-based index of the statement that failed. Omitted for single-statement requests.

Registered error codes in v0.1:

| `code`              | HTTP | Meaning                                                         |
|---------------------|------|-----------------------------------------------------------------|
| `bad_request`       | 400  | Request body shape is invalid.                                  |
| `sql_error`         | 400  | The SQL is invalid or failed at runtime.                        |
| `not_allowed`       | 400  | Statement shape is rejected by server policy.                   |
| `auth_error`        | 401  | Missing or invalid credentials.                                 |
| `permission_error`  | 403  | Authenticated but not permitted to run the statement.           |
| `payload_too_large` | 413  | Request body or result set exceeds a server limit.              |
| `rate_limited`      | 429  | Too many requests.                                              |
| `internal_error`    | 500  | Server malfunction.                                             |

Vendor codes carry the prefix `vendor:` (e.g. `vendor:cf_d1_quota_exceeded`). Clients SHOULD treat unknown `error.code` values as if they were the closest registered code by HTTP status family.

## 8. Pagination

http-sql v0.1 does not define pagination. Servers SHOULD enforce a server-defined maximum result row count and return `payload_too_large` if exceeded, with `error.message` suggesting `LIMIT` / `OFFSET` in the SQL. Cursor-based pagination is being considered for a future revision.

## 9. Version negotiation

Conforming servers SHOULD include the response header:

```
X-Http-Sql-Version: 0.1
```

on every response (including error responses).

Clients MAY send the request header:

```
X-Http-Sql-Accept-Version: 0.1
```

to indicate the maximum spec version they understand. Servers MAY use this for forward-compatible behavior. v0.1 servers ignore the header.

## 10. Conformance

### 10.1 Server conformance

A v0.1 conforming server MUST:

1. Accept POST requests with `Content-Type: application/json` at one or more endpoint URLs.
2. Accept both single-statement (section 4.1) and batch (section 4.2) request shapes.
3. Return the success envelopes defined in section 6 for successful execution.
4. Return the error envelope defined in section 7 for any failure, using the HTTP status codes in the table.
5. Honor `atomic: true` on batch requests when not rejected.
6. Accept the registered parameter types in section 5 (`blob`, `bigint`).
7. Emit the `X-Http-Sql-Version` response header.

A v0.1 conforming server MAY:

- Accept additional vendor-namespaced parameter types or error codes.
- Apply tenancy, ACLs, row-level security, query whitelisting, or any other policy. http-sql is transport, not policy.

### 10.2 Client conformance

A v0.1 conforming client MUST:

1. Send `Content-Type: application/json`.
2. Send exactly one of `sql` or `batch` in the request body.
3. Use the standard parameter encoding from section 5.
4. Handle the success and error envelopes from sections 6 and 7.
5. Not require any vendor-specific request or response fields beyond those defined here.

A v0.1 conforming client SHOULD:

- Send the `X-Http-Sql-Accept-Version` header.
- Treat `error.code` values it does not recognize as the closest registered code by HTTP status family.

## 11. Versioning policy

This spec uses `<major>.<minor>` versioning. Until `1.0`, the minor version increments on any breaking change. After `1.0`, breaking changes increment the major version. Additive changes (new optional fields, new registered types, new registered error codes) increment the minor version.

## 12. Security considerations

http-sql carries arbitrary SQL strings. Servers MUST treat the SQL as untrusted input from the perspective of authorization, even if the network channel is authenticated. Practical implications:

- A bearer token authenticates the caller but does not authorize arbitrary SQL. Servers SHOULD reject or rewrite statements that violate policy (tenancy, ACLs, allowlists) before execution.
- SQL parameters are passed positionally and SHOULD be bound to prepared statements server-side. Servers MUST NOT interpolate parameters into the SQL string before binding.
- Servers SHOULD enforce statement timeouts, result size limits, and rate limiting independent of the wire format.

The spec does not define encryption-at-rest or transport security. Implementations SHOULD use HTTPS.

## 13. IANA considerations

None at this stage. A future revision may register a media type (`application/http-sql+json`) and well-known URI suffix.
