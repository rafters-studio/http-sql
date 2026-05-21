# http-sql conformance

A conforming http-sql v0.1 server passes the test cases below when probed at its endpoint URL with a valid bearer token.

This directory will contain a runnable TypeScript test suite. The current document defines the test cases that runner must implement, so server implementers can self-check before installing the runner.

## How conformance is claimed

1. Implement the cases below against your endpoint.
2. Open a PR adding your implementation to [implementations.md](../implementations.md) (to be created).
3. Include a brief note on which optional features you support (tagged types beyond `blob`/`bigint`, vendor error codes, etc).

Conformance is self-asserted. The community can call out failures via issues.

## Required test cases

### Auth

| ID    | Description                                                      | Expected response                           |
|-------|------------------------------------------------------------------|---------------------------------------------|
| A-1   | POST with no `Authorization` header                              | 401, `error.code` = `auth_error`            |
| A-2   | POST with invalid bearer token                                   | 401, `error.code` = `auth_error`            |
| A-3   | POST with valid bearer token but request body is empty           | 400, `error.code` = `bad_request`           |

### Request shape

| ID    | Description                                                      | Expected response                           |
|-------|------------------------------------------------------------------|---------------------------------------------|
| R-1   | Body contains both `sql` and `batch`                             | 400, `error.code` = `bad_request`           |
| R-2   | Body contains neither `sql` nor `batch`                          | 400, `error.code` = `bad_request`           |
| R-3   | Body is not valid JSON                                           | 400, `error.code` = `bad_request`           |
| R-4   | `Content-Type` other than `application/json`                     | 400 or 415                                  |

### Single-statement execution

| ID    | Description                                                      | Expected response                           |
|-------|------------------------------------------------------------------|---------------------------------------------|
| S-1   | `SELECT 1`                                                       | 200, `columns: ["1"]`, `rows: [[1]]`        |
| S-2   | SELECT against a known table with params                         | 200, correct columns/rows shape             |
| S-3   | INSERT against a known table                                     | 200, `rowsAffected >= 1`                    |
| S-4   | Syntactically invalid SQL                                        | 400, `error.code` = `sql_error`             |
| S-5   | Reference to nonexistent table                                   | 400, `error.code` = `sql_error`             |

### Batch execution

| ID    | Description                                                      | Expected response                           |
|-------|------------------------------------------------------------------|---------------------------------------------|
| B-1   | Two INSERTs, no `atomic`                                         | 200, `results` array length 2               |
| B-2   | Two INSERTs with `atomic: true`                                  | 200, `results` array length 2               |
| B-3   | Atomic batch where the second statement fails                    | 400, error envelope, no rows persisted      |
| B-4   | Non-atomic batch where the second statement fails                | 400, error envelope (servers MAY also return 200 with partial results -- the spec leaves this implementation-defined; recommended behavior is to fail closed) |

### Parameter types

| ID    | Description                                                      | Expected response                           |
|-------|------------------------------------------------------------------|---------------------------------------------|
| P-1   | Roundtrip a TEXT param                                           | Returned value equals sent value            |
| P-2   | Roundtrip an INTEGER param                                       | Returned value equals sent value            |
| P-3   | Roundtrip a NULL param                                           | Returned value is JSON null                 |
| P-4   | Roundtrip a `blob` tagged value                                  | Returned value is `{"$type":"blob","$value":"<base64>"}` |
| P-5   | Roundtrip a `bigint` tagged value                                | Returned value is `{"$type":"bigint","$value":"<digits>"}` |
| P-6   | Send an unknown tagged type `{"$type":"unknown","$value":"..."}` | 400, `error.code` = `bad_request`           |

### Response headers

| ID    | Description                                                      | Expected response                           |
|-------|------------------------------------------------------------------|---------------------------------------------|
| H-1   | Any successful response                                          | Includes `X-Http-Sql-Version: 0.1`          |
| H-2   | Any error response                                               | Includes `X-Http-Sql-Version: 0.1`          |

## Optional / "nice to have"

- Vendor error codes carry the `vendor:` prefix.
- `lastInsertId` is populated for INSERT statements where the SQL engine reports it.
- Rate-limited responses return `error.code` = `rate_limited` and HTTP 429.
- Server enforces a maximum result row count and returns `payload_too_large` past it.

## Test fixture schema

The runner provisions a test schema before exercising the cases above. The fixture is intentionally tiny so any SQL backend can host it:

```sql
CREATE TABLE http_sql_conformance_notes (
  id TEXT PRIMARY KEY,
  body TEXT
);
```

Servers SHOULD allow the test runner to issue this `CREATE TABLE` as a normal http-sql request, or provide an out-of-band setup hook. The runner cleans up rows it inserts but does not drop the table.

## Status

The TypeScript runner is not yet implemented. This document is the contract it will be built against. Contributions welcome.
