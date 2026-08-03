// http-sql v0.2 over Cloudflare D1, with Hono.
//
// POST any http-sql v0.2 request to this Worker; it runs the SQL against the
// bound D1 database and returns a v0.2 response. Tagged params (blob, bigint)
// are decoded before binding; binary results are re-encoded going out.

import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";

export interface Env {
  DB: D1Database;
  HTTP_SQL_TOKEN: string;
}

interface Statement { sql: string; params?: unknown[]; }
interface SingleRequest { sql: string; params?: unknown[]; }
interface BatchRequest { batch: Statement[]; atomic?: boolean; }

interface StatementResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  lastInsertId?: string | null;
}

const VERSION = "0.2";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowMethods: ["POST", "OPTIONS"] }));
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Http-Sql-Version", VERSION);
});

app.post(
  "/",
  async (c, next) => bearerAuth({ token: c.env.HTTP_SQL_TOKEN })(c, next),
  async (c) => {
    if (!isJsonMediaType(c.req.header("content-type"))) {
      return c.json({ error: { code: "unsupported_media_type", message: "Content-Type must be application/json" } }, 415);
    }

    let body: SingleRequest | BatchRequest;
    try { body = await c.req.json(); }
    catch { return c.json({ error: { code: "bad_request", message: "invalid JSON" } }, 400); }

    const hasSql = "sql" in body && typeof body.sql === "string";
    const hasBatch = "batch" in body && Array.isArray(body.batch);
    if (hasSql === hasBatch) {
      return c.json({ error: { code: "bad_request", message: "request must contain exactly one of sql or batch" } }, 400);
    }

    try {
      if (hasSql) {
        const result = await runOne(c.env.DB, body as SingleRequest);
        return c.json(result);
      }
      const { batch, atomic = false } = body as BatchRequest;
      const results = await runBatch(c.env.DB, batch, atomic);
      return c.json({ results });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const statementIndex = (e as { statementIndex?: number }).statementIndex;
      const error: Record<string, unknown> = { code: "sql_error", message };
      if (statementIndex !== undefined) error.statementIndex = statementIndex;
      return c.json({ error }, 400);
    }
  },
);

// Bearer-auth middleware emits its own 401 -- override the envelope so it
// matches the spec's error shape.
app.onError((err, c) => {
  if (c.res.status === 401) {
    return c.json({ error: { code: "auth_error", message: "missing or invalid bearer token" } }, 401);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: { code: "internal_error", message } }, 500);
});

export default app;

async function runOne(db: D1Database, { sql, params = [] }: SingleRequest): Promise<StatementResult> {
  const bound = db.prepare(sql).bind(...params.map(decodeParam));
  const res = await bound.all();
  return projectD1Result(res);
}

async function runBatch(db: D1Database, batch: Statement[], atomic: boolean): Promise<StatementResult[]> {
  if (atomic) {
    const prepared = batch.map(({ sql, params = [] }) =>
      db.prepare(sql).bind(...params.map(decodeParam)),
    );
    const responses = await db.batch(prepared);
    return responses.map(projectD1Result);
  }
  const out: StatementResult[] = [];
  for (let i = 0; i < batch.length; i++) {
    try { out.push(await runOne(db, batch[i])); }
    catch (e) {
      const wrapped = e instanceof Error ? e : new Error(String(e));
      (wrapped as { statementIndex?: number }).statementIndex = i;
      throw wrapped;
    }
  }
  return out;
}

function projectD1Result(res: D1Result): StatementResult {
  const rows = (res.results ?? []) as Record<string, unknown>[];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  // SPEC 6.1: lastInsertId is a string or null, never a JSON number, so 64-bit
  // rowids survive clients whose numbers are IEEE-754 doubles.
  const lastRowId = res.meta?.last_row_id;
  return {
    columns,
    rows: rows.map((r) => columns.map((c) => encodeValue(r[c]))),
    rowsAffected: res.meta?.changes ?? 0,
    lastInsertId: lastRowId === undefined || lastRowId === null ? null : String(lastRowId),
  };
}

// SPEC.md section 2: only the media type is significant, so parameters such as
// `charset=utf-8` are ignored.
function isJsonMediaType(header: string | undefined): boolean {
  return header?.split(";")[0].trim().toLowerCase() === "application/json";
}

// Tagged values per SPEC.md section 5.
function decodeParam(value: unknown): unknown {
  if (value && typeof value === "object" && "$type" in value && "$value" in value) {
    const tag = value as { $type: string; $value: unknown };
    if (tag.$type === "blob" && typeof tag.$value === "string") return base64Decode(tag.$value);
    if (tag.$type === "bigint" && typeof tag.$value === "string") return BigInt(tag.$value);
    throw new Error(`unknown tagged $type: ${tag.$type}`);
  }
  return value;
}

// Response encoding per SPEC.md section 6.1. This branches on the runtime type
// D1 returned, which is only sufficient because the value survived the driver.
//
// KNOWN NON-CONFORMANCE (spec 6.1, conformance case V-1): D1 stores 64-bit
// INTEGERs but its Workers binding has no lossless mode -- there is no option,
// method, or compatibility flag that makes it return a BigInt, so an integer
// above 2^53 comes back as an already-rounded double and reaches this function
// as a `number`. The original value is gone before any encoding step runs and
// this branch cannot recover it. Tracked upstream at
// https://github.com/cloudflare/workerd/issues/4195 (open). Until that lands,
// the workaround is at the SQL layer: `SELECT CAST(col AS TEXT)` keeps the
// digits intact. Applying that automatically would require parsing the caller's
// SQL and inferring column types, which this example deliberately does not do.
function encodeValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { $type: "blob", $value: base64Encode(new Uint8Array(value)) };
  if (typeof value === "bigint") return { $type: "bigint", $value: value.toString() };
  return value;
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
