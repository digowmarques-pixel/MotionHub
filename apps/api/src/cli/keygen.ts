import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const out = process.argv[2] ?? "./keys/pack-signing.pem";
if (existsSync(out)) {
  console.error(`${out} já existe; não vou sobrescrever.`);
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(out.replace(/\.pem$/, ".pub.pem"), publicKey.export({ type: "spki", format: "pem" }));
console.log(`chave privada: ${out} (guarde em cofre de segredos)\nchave pública: ${out.replace(/\.pem$/, ".pub.pem")}`);
