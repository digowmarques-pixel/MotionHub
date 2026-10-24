/**
 * Fila de jobs sobre PostgreSQL (FOR UPDATE SKIP LOCKED) — "Redis/BullMQ ou equivalente" (§8).
 * Evita uma peça extra de infraestrutura; troca por BullMQ é isolada neste módulo.
 */
import type { Db, Queryable } from "../db.js";

export type JobKind = "preview" | "pack_build";

export interface JobRow {
  id: string;
  kind: JobKind;
  input: Record<string, unknown>;
  retries: number;
  max_retries: number;
}

export async function enqueue(q: Queryable, kind: JobKind, input: Record<string, unknown>, maxRetries = 3): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    "INSERT INTO jobs (kind, input, max_retries) VALUES ($1, $2, $3) RETURNING id",
    [kind, JSON.stringify(input), maxRetries],
  );
  return rows[0]!.id;
}

/** Reserva o próximo job disponível. Jobs "running" travados há mais de 15 min são retomados. */
export async function claim(db: Db, kinds: JobKind[]): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `UPDATE jobs SET status = 'running', locked_at = now(), updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE kind = ANY($1) AND run_after <= now()
         AND (status = 'queued' OR (status = 'running' AND locked_at < now() - interval '15 minutes'))
       ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING id, kind, input, retries, max_retries`,
    [kinds],
  );
  return rows[0] ?? null;
}

export async function progress(q: Queryable, id: string, value: number): Promise<void> {
  await q.query("UPDATE jobs SET progress = $2, updated_at = now() WHERE id = $1", [id, value]);
}

export async function succeed(q: Queryable, id: string, output: Record<string, unknown>): Promise<void> {
  await q.query("UPDATE jobs SET status = 'succeeded', progress = 1, output = $2, locked_at = NULL, updated_at = now() WHERE id = $1", [id, JSON.stringify(output)]);
}

/** Falha com retry exponencial (30s, 2min, 8min...) até max_retries; depois falha definitiva. */
export async function failJob(q: Queryable, job: JobRow, code: string, detail: string, retryable = true): Promise<void> {
  const final = !retryable || job.retries + 1 >= job.max_retries;
  await q.query(
    `UPDATE jobs SET status = $2, retries = retries + 1, error_code = $3, error_detail = $4, locked_at = NULL,
       run_after = now() + make_interval(secs => $5), updated_at = now() WHERE id = $1`,
    [job.id, final ? "failed" : "queued", code, detail.slice(0, 2000), 30 * 4 ** job.retries],
  );
}
