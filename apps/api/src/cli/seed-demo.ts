/**
 * Popula o catálogo com assets de DEMONSTRAÇÃO (mídia sintética gerada com ffmpeg),
 * percorrendo o fluxo real: rascunho → upload → revisão → preview → publicação.
 * Uso: pnpm seed-demo -- --email admin@... --password '...'
 * Não usar em produção.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import yazl from "yazl";
import { buildApp } from "../app.js";
import { createContext } from "../bootstrap.js";
import { migrate } from "../db.js";
import { sha256Hex } from "../crypto.js";
import { runOnce } from "../jobs/worker.js";

const { values } = parseArgs({ options: { email: { type: "string" }, password: { type: "string" } } });
if (!values.email || !values.password) throw new Error("Informe --email e --password de um admin.");

const DEMOS = [
  { id: "demo-titulo-rise", name: "Título Rise Institucional", type: "title", color: "0x1e3a8a", tags: ["institucional", "clean"], summary: "Título com entrada suave de baixo para cima.", text: true },
  { id: "demo-titulo-bold", name: "Título Bold Impacto", type: "title", color: "0x7c2d12", tags: ["impacto", "promo"], summary: "Tipografia pesada com escala rápida.", text: true },
  { id: "demo-lower-third", name: "Lower Third Corporativo", type: "title", color: "0x064e3b", tags: ["institucional", "entrevista"], synonyms: ["tarja", "gc"], summary: "Tarja de nome e cargo para entrevistas.", text: true },
  { id: "demo-texto-kinetic", name: "Texto Kinetic Typo", type: "text", color: "0x4c1d95", tags: ["kinetic", "redes"], summary: "Palavras surgindo em ritmo.", text: true },
  { id: "demo-transicao-glitch", name: "Transição Glitch", type: "transition", color: "0x831843", tags: ["glitch", "rápido"] },
  { id: "demo-transicao-zoom", name: "Transição Zoom Blur", type: "transition", color: "0x1e293b", tags: ["zoom", "dinâmico"] },
  { id: "demo-overlay-luz", name: "Overlay Light Leak", type: "overlay", color: "0x92400e", tags: ["luz", "quente"] },
  { id: "demo-overlay-poeira", name: "Overlay Poeira Analógica", type: "overlay", color: "0x3f3f46", tags: ["textura", "vintage"] },
  { id: "demo-shape-circulo", name: "Shape Círculo Pulsante", type: "shape", color: "0x0e7490", tags: ["forma", "destaque"] },
  { id: "demo-sfx-whoosh", name: "Whoosh Rápido", type: "sfx", tags: ["som", "transição"], audio: 880 },
  { id: "demo-sfx-impacto", name: "Impacto Grave", type: "sfx", tags: ["som", "impacto"], audio: 110 },
  { id: "demo-timer-10s", name: "Contador 10 segundos", type: "timer", color: "0x365314", tags: ["contagem", "live"] },
] as const;

const ctx = createContext();
await migrate(ctx.db);
const app = await buildApp(ctx);
const dir = mkdtempSync(join(tmpdir(), "mh-demo-"));
const ff = (...a: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);

const login = await app.inject({ method: "POST", url: "/v1/auth/session", payload: { email: values.email, password: values.password } });
if (login.statusCode !== 200) throw new Error(`login falhou: ${login.body}`);
const auth = { authorization: `Bearer ${login.json().accessToken}` };

async function mogrt(name: string): Promise<Buffer> {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from(JSON.stringify({ demo: true, name })), "definition.json");
  z.end();
  const chunks: Buffer[] = [];
  for await (const c of z.outputStream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

for (const d of DEMOS) {
  const isAudio = "audio" in d;
  const files: Array<[string, Buffer, string]> = [];
  if (isAudio) {
    const wav = join(dir, `${d.id}.wav`);
    ff("-f", "lavfi", "-i", `sine=frequency=${d.audio}:duration=1.2`, "-af", "afade=t=out:st=0.4:d=0.8", wav);
    files.push(["audio/sfx.wav", readFileSync(wav), "audio"]);
    files.push(["preview/preview.wav", readFileSync(wav), "preview"]);
    files.push(["preview/poster.wav", readFileSync(wav), "poster"]);
  } else {
    const mp4 = join(dir, `${d.id}.mp4`);
    const png = join(dir, `${d.id}.png`);
    const label = d.name.replace(/[^A-Za-z0-9 ]/g, "");
    const vf = `drawbox=x='mod(t*400,iw)':y=ih/2-60:w=220:h=120:color=white@0.85:t=fill,drawbox=x=0:y=ih-24:w='iw*t/3':h=24:color=white@0.5:t=fill`;
    ff("-f", "lavfi", "-i", `color=c=${d.color}:s=1280x720:r=30:d=3`, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4);
    ff("-ss", "1.2", "-i", mp4, "-frames:v", "1", png);
    void label;
    if ("text" in d) files.push(["template/title.mogrt", await mogrt(d.name), "template"]);
    else files.push(["media/clip.mp4", readFileSync(mp4), "media"]);
    files.push(["preview/loop.mp4", readFileSync(mp4), "preview"]);
    files.push(["preview/poster.png", readFileSync(png), "poster"]);
  }
  const main = files[0]!;
  const manifest = {
    schemaVersion: "1.0",
    id: d.id,
    version: "1.0.0",
    name: d.name,
    type: d.type,
    summary: "summary" in d ? d.summary : undefined,
    hosts: [{ name: "premiere", minVersion: "25.6" }],
    assets: [{ path: main[0], sha256: sha256Hex(main[1]), role: main[2] }],
    preview: { path: files[1]![0], poster: files[2]![0] },
    parameters:
      "text" in d
        ? [
            { key: "headline", label: "Headline", type: "string", default: "MEGALUME", maxLength: 120, group: "Texto" },
            { key: "subtitle", label: "Subtitle", type: "string", default: "Produtora audiovisual", maxLength: 120, group: "Texto" },
            { key: "primaryColor", label: "Cor principal", type: "color", default: "#FFFFFF", group: "Estilo" },
            { key: "easing", label: "Curva", type: "easing", default: "easeOut", group: "Estilo" },
            { key: "durationSec", label: "Duração", type: "duration", default: 3, min: 0.5, max: 20, group: "Tempo" },
          ]
        : [],
    aspectRatio: "16:9",
    durationSec: isAudio ? 1.2 : 3,
    language: "pt-BR",
    license: "megalume-internal",
    tags: [...d.tags, "demo"],
    synonyms: "synonyms" in d ? [...d.synonyms] : [],
  };
  const c = await app.inject({ method: "POST", url: "/v1/admin/assets", headers: auth, payload: { manifest } });
  if (c.statusCode === 409) {
    console.log(`já existe: ${d.id}`);
    continue;
  }
  if (c.statusCode !== 201) throw new Error(`${d.id}: ${c.body}`);
  const assetId = c.json().assetId;
  for (const [path, body] of files) {
    const u = await app.inject({ method: "PUT", url: `/v1/admin/assets/${assetId}/versions/1.0.0/files/${path}`, headers: { ...auth, "content-type": "application/octet-stream" }, payload: body });
    if (u.statusCode !== 201) throw new Error(`${d.id} ${path}: ${u.body}`);
  }
  await app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/versions/1.0.0/submit`, headers: auth });
  while (await runOnce(ctx)) {}
  const p = await app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/publish`, headers: auth, payload: { semver: "1.0.0" } });
  if (p.statusCode !== 200) throw new Error(`${d.id} publish: ${p.body}`);
  console.log(`publicado: ${d.name}`);
}
rmSync(dir, { recursive: true, force: true });
await app.close();
await ctx.db.end();
