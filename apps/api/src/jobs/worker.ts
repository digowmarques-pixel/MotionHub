import type { AppContext } from "../context.js";
import { claim, failJob, succeed, type JobKind, type JobRow } from "./queue.js";
import { PermanentJobError, packBuildJob, previewJob } from "./handlers.js";

const HANDLERS: Record<JobKind, (ctx: AppContext, job: JobRow) => Promise<Record<string, unknown>>> = {
  preview: previewJob,
  pack_build: packBuildJob,
};

/** Processa um job, se houver. Retorna true se processou algo. */
export async function runOnce(ctx: AppContext, log: (m: string) => void = () => {}): Promise<boolean> {
  const job = await claim(ctx.db, Object.keys(HANDLERS) as JobKind[]);
  if (!job) return false;
  try {
    const out = await HANDLERS[job.kind](ctx, job);
    await succeed(ctx.db, job.id, out);
    log(`job ${job.kind} ${job.id} concluído`);
  } catch (e) {
    const permanent = e instanceof PermanentJobError;
    await failJob(ctx.db, job, permanent ? e.code : "error", (e as Error).message, !permanent);
    if (job.kind === "pack_build" && (permanent || job.retries + 1 >= job.max_retries)) {
      await ctx.db.query("UPDATE packs SET status = 'failed' WHERE id = $1", [job.input.packId]);
    }
    log(`job ${job.kind} ${job.id} falhou: ${(e as Error).message}`);
  }
  return true;
}

export function startWorker(ctx: AppContext, log: (m: string) => void, intervalMs = 1000): () => Promise<void> {
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const did = await runOnce(ctx, log).catch((e) => {
        log(`erro no worker: ${(e as Error).message}`);
        return false;
      });
      if (!did) await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return async () => {
    stopped = true;
    await loop;
  };
}
