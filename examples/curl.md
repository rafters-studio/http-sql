# http-sql curl examples

Every request below assumes `ENDPOINT` is the http-sql endpoint URL and `TOKEN` is a valid bearer token.

## Single SELECT

```sh
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sql": "SELECT id, body FROM notes WHERE tenant_id = ?",
    "params": ["alice"]
  }'
```

Response:

```json
{
  "columns": ["id", "body"],
  "rows": [["a-uuid", "first note"], ["b-uuid", "second note"]],
  "rowsAffected": 0,
  "lastInsertId": null
}
```

## INSERT

```sh
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sql": "INSERT INTO notes (id, tenant_id, body) VALUES (?, ?, ?)",
    "params": ["c-uuid", "alice", "third note"]
  }'
```

Response:

```json
{
  "columns": [],
  "rows": [],
  "rowsAffected": 1,
  "lastInsertId": "c-uuid"
}
```

## Atomic batch

```sh
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "batch": [
      {"sql": "INSERT INTO notes (id, tenant_id, body) VALUES (?, ?, ?)", "params": ["d-uuid", "alice", "fourth"]},
      {"sql": "INSERT INTO notes (id, tenant_id, body) VALUES (?, ?, ?)", "params": ["e-uuid", "alice", "fifth"]}
    ],
    "atomic": true
  }'
```

Response:

```json
{
  "results": [
    {"columns": [], "rows": [], "rowsAffected": 1, "lastInsertId": "d-uuid"},
    {"columns": [], "rows": [], "rowsAffected": 1, "lastInsertId": "e-uuid"}
  ]
}
```

## Blob parameter (tagged value)

```sh
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sql": "INSERT INTO attachments (id, data) VALUES (?, ?)",
    "params": [
      "att-uuid",
      {"$type": "blob", "$value": "SGVsbG8gd29ybGQ="}
    ]
  }'
```

## SQL error

```sh
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sql": "SELEC * FROM notes"}'
```

Response (HTTP 400):

```json
{
  "error": {
    "code": "sql_error",
    "message": "syntax error near 'SELEC'"
  }
}
```

## Auth error

```sh
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT 1"}'
```

Response (HTTP 401):

```json
{
  "error": {
    "code": "auth_error",
    "message": "missing bearer token"
  }
}
```
