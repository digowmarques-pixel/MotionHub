import { createContext } from "../bootstrap.js";
import { startWorker } from "../jobs/worker.js";

const ctx = createContext();
const stop = startWorker(ctx, (m) => console.log(new Date().toISOString(), m));
console.log("worker de previews/pacotes iniciado");
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    await stop();
    await ctx.db.end();
    process.exit(0);
  });
}
