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
    return this.send({ batch: statements, atomic }) as Promise<BatchResult>;
  }

  private async send(body: unknown): Promise<unknown> {
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
      throw Object.assign(new Error(err.message), { code: err.code, statementIndex: err.statementIndex });
    }

    return json;
  }
}
