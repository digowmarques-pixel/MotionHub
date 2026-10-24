#!/usr/bin/env node
/**
 * Envia o conteúdo gerado (ou qualquer pasta no mesmo formato) para um servidor Motion Hub,
 * pelo mesmo fluxo do painel: rascunho → upload verificado → revisão → (publicação) → pacotes.
 *
 *   node import.mjs --dir ./saida --server https://motionhub.megalume.com.br --email voce@megalume.com.br [--publish] [--packs]
 *   A senha é pedida pela variável MOTIONHUB_PASSWORD (não fica no histórico do terminal).
 *
 * Sem dependências: Node 20+.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    dir: { type: "string" },
    server: { type: "string" },
    email: { type: "string" },
    version: { type: "string", default: "1.0.0" },
    "pack-version": { type: "string", default: "1.0.0" },
    publish: { type: "boolean", default: false },
    packs: { type: "boolean", default: false },
  },
});
const password = process.env.MOTIONHUB_PASSWORD;
if (!a.dir || !a.server || !a.email || !password) {
  console.error("Uso: MOTIONHUB_PASSWORD='...' node import.mjs --dir ./saida --server https://... --email voce@... [--publish] [--packs]");
  process.exit(1);
}
const base = a.server.replace(/\/+$/, "");
let token = null;

async function api(method, path, body, raw) {
  const headers = { Authorization: `Bearer ${token}` };
  if (raw) headers["Content-Type"] = "application/octet-stream";
  else if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(`${method} ${path}: ${json?.error?.message ?? res.status}${json?.error?.details ? " " + JSON.stringify(json.error.details) : ""}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(base + "/v1/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: a.email, password }) });
if (!login.ok) {
  console.error("Login falhou:", (await login.json().catch(() => ({})))?.error?.message ?? login.status);
  process.exit(1);
}
token = (await login.json()).accessToken;

const dirs = readdirSync(a.dir).filter((d) => existsSync(join(a.dir, d, "item.json"))).sort();
console.log(`${dirs.length} itens encontrados em ${a.dir}`);
const created = [];

for (const d of dirs) {
  const item = JSON.parse(readFileSync(join(a.dir, d, "item.json"), "utf8"));
  const mainBuf = readFileSync(join(a.dir, d, item.main));
  const mainPath = `${item.role}/${item.main}`;
  const files = [[mainPath, join(a.dir, d, item.main)], [`preview/${item.preview}`, join(a.dir, d, item.preview)], [`preview/${item.poster}`, join(a.dir, d, item.poster)]];
  const manifest = {
    schemaVersion: "1.0",
    id: item.id,
    version: a.version,
    name: item.name,
    type: item.type,
    summary: item.summary,
    // Mídia e áudio funcionam nos dois hosts; o After Effects entra quando o plugin dele existir.
    hosts: [{ name: "premiere", minVersion: "25.6" }, { name: "after-effects", minVersion: "25.0" }],
    assets: [{ path: mainPath, sha256: sha256(mainBuf), role: item.role, bytes: mainBuf.length }],
    preview: { path: `preview/${item.preview}`, poster: `preview/${item.poster}` },
    parameters: [],
    aspectRatio: item.aspectRatio ?? "16:9",
    durationSec: item.durationSec,
    fps: item.fps,
    license: item.license,
    tags: item.tags,
    synonyms: item.synonyms ?? [],
  };
  let res;
  try {
    res = await api("POST", "/v1/admin/assets", { manifest, category: item.pack, changelog: item.origin });
  } catch (e) {
    if (e.status === 409) {
      console.log(`= ${item.name}: versão ${a.version} já existe, pulando`);
      continue;
    }
    throw e;
  }
  for (const [path, file] of files) {
    await api("PUT", `/v1/admin/assets/${res.assetId}/versions/${a.version}/files/${path}`, undefined, readFileSync(file));
  }
  await api("POST", `/v1/admin/assets/${res.assetId}/versions/${a.version}/submit`);
  created.push({ assetId: res.assetId, item });
  console.log(`+ ${item.name} (${(statSync(join(a.dir, d, item.main)).size / 1e6).toFixed(1)} MB) enviado para revisão`);
}

if (a.publish) {
  console.log("Aguardando previews padronizados para publicar…");
  for (const { assetId, item } of created) {
    for (let i = 0; ; i++) {
      const det = await api("GET", `/v1/admin/assets/${assetId}`);
      const job = det.jobs[0];
      if (job?.status === "succeeded") break;
      if (job?.status === "failed") throw new Error(`Preview de ${item.name} falhou: ${job.error_detail}`);
      if (i > 300) throw new Error(`Tempo esgotado esperando preview de ${item.name}`);
      await sleep(1000);
    }
    await api("POST", `/v1/admin/assets/${assetId}/publish`, { semver: a.version });
    console.log(`✓ publicado: ${item.name}`);
  }
}

if (a.packs) {
  const packsFile = join(a.dir, "packs.json");
  const meta = existsSync(packsFile) ? JSON.parse(readFileSync(packsFile, "utf8")) : {};
  const all = (await api("GET", "/v1/assets?state=published&limit=200")).items;
  const groups = new Map();
  for (const d of dirs) {
    const item = JSON.parse(readFileSync(join(a.dir, d, "item.json"), "utf8"));
    const asset = all.find((x) => x.slug === item.id);
    if (!asset) continue;
    groups.set(item.pack, [...(groups.get(item.pack) ?? []), { assetId: asset.id, semver: asset.latestVersion }]);
  }
  for (const [key, items] of groups) {
    const m = meta[key] ?? { slug: `megalume-${key}`, name: `Megalume · ${key}` };
    try {
      await api("POST", "/v1/admin/packs", { slug: m.slug, name: m.name, version: a["pack-version"], license: "megalume-internal", items });
      console.log(`▣ pacote ${m.name} (${items.length} itens) em geração`);
    } catch (e) {
      console.log(`= pacote ${m.name}: ${e.message}`);
    }
  }
}
console.log("Concluído.");
