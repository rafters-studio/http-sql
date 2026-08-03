// Reference http-sql v0.1 client, ~40 lines.
//
// Uses the platform `fetch`. No dependencies.

interface Statement { sql: string; params?: unknown[]; }

interface Result {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  lastInsertId?: string | number | null;
}

interface BatchResult { results: Result[]; }

interface HttpSqlError {
  code: string;
  message: string;
  statementIndex?: number;
}

export class HttpSqlClient {
  constructor(private endpoint: string, private token: string) {}

  async execute(sql: string, params: unknown[] = []): Promise<Result> {
    return this.send({ sql, params }) as Promise<Result>;
  }

  async batch(statements: Statement[], atomic = false): Promise<BatchResult> {
    return this.send({ batch: statements, atomic }, atomic) as Promise<BatchResult>;
  }

  // `atomic` is undefined for single-statement requests.
  private async send(body: unknown, atomic?: boolean): Promise<unknown> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.token}`,
        "x-http-sql-accept-version": "0.1",
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || (typeof json === "object" && json !== null && "error" in json)) {
      const err = (json as { error?: HttpSqlError }).error ?? {
        code: "internal_error",
        message: `HTTP ${res.status}`,
      };
      // Section 6.2.1: a non-atomic batch error does NOT mean nothing applied --
      // statements before statementIndex persisted. Atomic batches rolled back,
      // and a failed single statement applied nothing, so both are 0.
      // `undefined` means exactly one thing: a non-atomic batch whose server
      // omitted the REQUIRED statementIndex, so how far it got is UNKNOWN.
      // Never treat that as zero -- a caller reading zero replays applied work.
      const appliedCount = atomic === false ? err.statementIndex : 0;

      throw Object.assign(new Error(err.message), {
        code: err.code,
        statementIndex: err.statementIndex,
        appliedCount,
      });
    }

    return json;
  }
}
