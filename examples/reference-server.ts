// Reference http-sql v0.2 server, ~80 lines.
//
// Runs on any platform with `fetch`-style Request/Response (Workers, Deno,
// Bun, Node 20+ with the undici fetch globals). The SQL execution is faked
// here -- replace `execute()` with your actual database call.

interface Statement { sql: string; params?: unknown[]; }
interface SingleRequest { sql: string; params?: unknown[]; }
interface BatchRequest { batch: Statement[]; atomic?: boolean; }
type RequestBody = SingleRequest | BatchRequest;

interface Result {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  lastInsertId?: string | number | null;
}

const VERSION_HEADER = { "X-Http-Sql-Version": "0.2" };
const JSON_HEADERS = { "content-type": "application/json", ...VERSION_HEADER };

export async function handle(req: Request, auth: (req: Request) => boolean): Promise<Response> {
  if (!auth(req)) return errorResponse(401, "auth_error", "missing or invalid bearer token");
  if (req.method !== "POST") return errorResponse(405, "bad_request", "POST required");
  if (!isJsonMediaType(req.headers.get("content-type"))) {
    return errorResponse(415, "unsupported_media_type", "Content-Type must be application/json");
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return errorResponse(400, "bad_request", "invalid JSON"); }

  const hasSql = "sql" in body && typeof body.sql === "string";
  const hasBatch = "batch" in body && Array.isArray(body.batch);
  if (hasSql === hasBatch) {
    return errorResponse(400, "bad_request", "request must contain exactly one of sql or batch");
  }

  try {
    if (hasSql) {
      const result = await execute(body as SingleRequest);
      return ok(result);
    }
    const { batch, atomic = false } = body as BatchRequest;
    const results = await executeBatch(batch, atomic);
    return ok({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statementIndex = (err as { statementIndex?: number }).statementIndex;
    return errorResponse(400, "sql_error", message, statementIndex);
  }
}

// SPEC.md section 2: only the media type is significant, so parameters such as
// `charset=utf-8` are ignored.
function isJsonMediaType(header: string | null): boolean {
  return header?.split(";")[0].trim().toLowerCase() === "application/json";
}

// Replace these with calls to your actual database client.
async function execute(_stmt: Statement): Promise<Result> {
  return { columns: [], rows: [], rowsAffected: 0, lastInsertId: null };
}

async function executeBatch(batch: Statement[], atomic: boolean): Promise<Result[]> {
  // SPEC.md 6.2.1: batches execute sequentially in array order, stopping at
  // the first failure; a non-atomic failure carries error.statementIndex.
  // In a real server the atomic branch wraps this loop in a transaction.
  const out: Result[] = [];
  for (let i = 0; i < batch.length; i++) {
    try {
      out.push(await execute(batch[i]));
    } catch (err) {
      if (!atomic && err !== null && typeof err === "object") {
        (err as { statementIndex?: number }).statementIndex = i;
      }
      throw err;
    }
  }
  return out;
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

function errorResponse(status: number, code: string, message: string, statementIndex?: number): Response {
  const error: Record<string, unknown> = { code, message };
  if (statementIndex !== undefined) error.statementIndex = statementIndex;
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

// Example boot under Deno / Bun / Workers:
//
//   export default { fetch: (req: Request) => handle(req, hasValidBearer) };
//
// where `hasValidBearer` reads the Authorization header and validates the token
// however your app does it.
