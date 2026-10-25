// Copia uma biblioteca em pasta para dev-dist/biblioteca e gera _lista.json (simulação do NAS no navegador).
// Uso: node dev/make-listing.mjs /caminho/da/biblioteca
import { cpSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const src = process.argv[2];
const dest = new URL("../dev-dist/biblioteca", import.meta.url).pathname;
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
const out = [];
const walk = (dir, depth) => {
  const entries = readdirSync(dir);
  const files = entries.filter((e) => statSync(join(dir, e)).isFile());
  const rel = relative(dest, dir).split("\\").join("/");
  if (rel && files.length) out.push({ dir: rel, files });
  if (depth < 3) for (const e of entries) if (statSync(join(dir, e)).isDirectory()) walk(join(dir, e), depth + 1);
};
walk(dest, 0);
writeFileSync(join(dest, "_lista.json"), JSON.stringify(out));
console.log(`${out.length} pastas listadas em ${dest}`);
