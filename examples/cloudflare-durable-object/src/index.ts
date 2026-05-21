// http-sql v0.1 over Cloudflare Durable Objects, with Hono.
//
// Each tenant maps to its own DO instance, and each DO holds its own real
// SQLite via ctx.storage.sql. The Worker is just a router: validate the
// bearer, resolve it to a tenant, forward the request to that tenant's DO.
//
// The flagship dogfood for "SQLite on the client, SQLite on the server,
// content-hash diff between them" -- the server side is a real SQLite per
// tenant, not a row-partitioned shared table.

import { Hono } from "hono";
import { cors } from "hono/cors";

export interface Env {
  TENANT_DO: DurableObjectNamespace;
  TENANT_TOKEN_ALICE: string;
  TENANT_TOKEN_BOB: string;
}

const VERSION = "0.1";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowMethods: ["POST", "OPTIONS"] }));
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Http-Sql-Version", VERSION);
});

app.post("/sql", async (c) => {
  const tenant = resolveTenant(c.req.header("authorization") ?? "", c.env);
  if (!tenant) return c.json({ error: { code: "auth_error", message: "missing or invalid bearer token" } }, 401);

  const id = c.env.TENANT_DO.idFromName(tenant);
  const stub = c.env.TENANT_DO.get(id);
  return stub.fetch(c.req.raw);
});

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: { code: "internal_error", message } }, 500);
});

export default app;

function resolveTenant(header: string, env: Env): string | null {
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (token === env.TENANT_TOKEN_ALICE) return "alice";
  if (token === env.TENANT_TOKEN_BOB) return "bob";
  return null;
}

// =============================================================================
// TenantDO: one Durable Object per tenant. Holds a real SQLite database via
// ctx.storage.sql. Receives http-sql v0.1 envelopes from the router and runs
// them against its own SQLite. All access for a given tenant is serialized
// through this single instance.
// =============================================================================

interface Statement { sql: string; params?: unknown[]; }
interface SingleRequest { sql: string; params?: unknown[]; }
interface BatchRequest { batch: Statement[]; atomic?: boolean; }

interface StatementResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  lastInsertId?: string | number | null;
}

export class TenantDO {
  private sql: SqlStorage;

  constructor(private ctx: DurableObjectState, _env: Env) {
    this.sql = ctx.storage.sql;
  }

  async fetch(req: Request): Promise<Response> {
    let body: SingleRequest | BatchRequest;
    try { body = await req.json(); }
    catch { return json({ error: { code: "bad_request", message: "invalid JSON" } }, 400); }

    const hasSql = "sql" in body && typeof body.sql === "string";
    const hasBatch = "batch" in body && Array.isArray(body.batch);
    if (hasSql === hasBatch) {
      return json({ error: { code: "bad_request", message: "request must contain exactly one of sql or batch" } }, 400);
    }

    try {
      if (hasSql) {
        const result = this.runOne(body as SingleRequest);
        return json(result);
      }
      const { batch, atomic = false } = body as BatchRequest;
      const results = this.runBatch(batch, atomic);
      return json({ results });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const statementIndex = (e as { statementIndex?: number }).statementIndex;
      const error: Record<string, unknown> = { code: "sql_error", message };
      if (statementIndex !== undefined) error.statementIndex = statementIndex;
      return json({ error }, 400);
    }
  }

  private runOne({ sql, params = [] }: SingleRequest): StatementResult {
    const cursor = this.sql.exec(sql, ...params.map(decodeParam));
    const columns = cursor.columnNames;
    const rows: unknown[][] = [];
    for (const row of cursor) {
      rows.push(columns.map((c) => encodeValue(row[c])));
    }
    return {
      columns,
      rows,
      rowsAffected: this.sql.rowsWritten - rows.length,
      lastInsertId: null,
    };
  }

  private runBatch(batch: Statement[], atomic: boolean): StatementResult[] {
    if (atomic) {
      return this.ctx.storage.transactionSync(() => batch.map((s) => this.runOne(s)));
    }
    const out: StatementResult[] = [];
    for (let i = 0; i < batch.length; i++) {
      try { out.push(this.runOne(batch[i])); }
      catch (e) {
        const wrapped = e instanceof Error ? e : new Error(String(e));
        (wrapped as { statementIndex?: number }).statementIndex = i;
        throw wrapped;
      }
    }
    return out;
  }
}

const JSON_HEADERS = {
  "content-type": "application/json",
  "X-Http-Sql-Version": VERSION,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function decodeParam(value: unknown): unknown {
  if (value && typeof value === "object" && "$type" in value && "$value" in value) {
    const tag = value as { $type: string; $value: unknown };
    if (tag.$type === "blob" && typeof tag.$value === "string") return base64Decode(tag.$value);
    if (tag.$type === "bigint" && typeof tag.$value === "string") return BigInt(tag.$value);
    throw new Error(`unknown tagged $type: ${tag.$type}`);
  }
  return value;
}

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
