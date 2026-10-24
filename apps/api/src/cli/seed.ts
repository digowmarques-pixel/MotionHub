/**
 * Cria organização e usuários iniciais. Uso:
 *   pnpm seed -- --org "Megalume" --admin-email admin@megalume.com.br --admin-password '<senha forte>'
 */
import { parseArgs } from "node:util";
import { createContext } from "../bootstrap.js";
import { migrate } from "../db.js";
import { hashPassword } from "../crypto.js";

const { values } = parseArgs({
  options: {
    org: { type: "string", default: "Megalume" },
    "admin-email": { type: "string" },
    "admin-password": { type: "string" },
    "admin-name": { type: "string", default: "Administrador" },
  },
});
if (!values["admin-email"] || !values["admin-password"] || values["admin-password"].length < 12) {
  console.error("Informe --admin-email e --admin-password (mín. 12 caracteres).");
  process.exit(1);
}
const ctx = createContext();
await migrate(ctx.db, console.log);
const org =
  (await ctx.db.query<{ id: string }>("SELECT id FROM orgs WHERE name = $1", [values.org])).rows[0] ??
  (await ctx.db.query<{ id: string }>("INSERT INTO orgs (name) VALUES ($1) RETURNING id", [values.org])).rows[0]!;
await ctx.db.query(
  `INSERT INTO users (org_id, name, email, role, password_hash) VALUES ($1,$2,$3,'admin',$4)
   ON CONFLICT (lower(email)) DO NOTHING`,
  [org.id, values["admin-name"], values["admin-email"], await hashPassword(values["admin-password"])],
);
console.log(`organização ${values.org} (${org.id}) e admin ${values["admin-email"]} prontos`);
await ctx.db.end();
