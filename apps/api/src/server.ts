import { buildApp } from "./app.js";
import { createContext } from "./bootstrap.js";
import { migrate } from "./db.js";
import { startWorker } from "./jobs/worker.js";

const ctx = createContext();
const app = await buildApp(ctx, { logger: true });
await migrate(ctx.db, (m) => app.log.info(m));
if (!ctx.signer) app.log.warn("PACK_SIGNING_KEY_PATH não configurado: criação de pacotes desabilitada.");

// Em desenvolvimento o worker roda no mesmo processo; em produção use `pnpm worker` em container isolado.
const stopWorker = process.env.INLINE_WORKER === "0" ? null : startWorker(ctx, (m) => app.log.info(m));

await app.listen({ port: ctx.config.port, host: "0.0.0.0" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    await app.close();
    await stopWorker?.();
    await ctx.db.end();
    process.exit(0);
  });
}
