import { createContext } from "../bootstrap.js";
import { migrate } from "../db.js";

const ctx = createContext();
await migrate(ctx.db, console.log);
console.log("banco atualizado");
await ctx.db.end();
