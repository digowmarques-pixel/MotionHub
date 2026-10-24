import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicKey, verify } from "node:crypto";
import { canonicalJson, sha256Hex } from "../src/crypto.js";
import { runOnce } from "../src/jobs/worker.js";
import { bearer, login, makeMedia, manifestFor, setup, type TestEnv } from "./helpers.js";

let env: TestEnv;
let media: Awaited<ReturnType<typeof makeMedia>>;
const tok: Record<string, string> = {};

beforeAll(async () => {
  env = await setup();
  media = await makeMedia(env.dir);
  for (const k of ["editor", "designer", "curator", "admin"] as const) tok[k] = await login(env, k);
});
afterAll(async () => { if (!process.env.KEEP_DB) await env?.close(); });

const upload = (assetId: string, semver: string, path: string, body: Buffer, who = "designer") =>
  env.app.inject({
    method: "PUT",
    url: `/v1/admin/assets/${assetId}/versions/${semver}/files/${path}`,
    headers: { ...bearer(tok[who]!), "content-type": "application/octet-stream" },
    payload: body,
  });

async function drainJobs() {
  while (await runOnce(env.ctx)) {}
}

describe("autenticação", () => {
  it("recusa senha errada sem revelar se o e-mail existe", async () => {
    const a = await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { email: "editor@megalume.test", password: "errada-123456" } });
    const b = await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { email: "ninguem@megalume.test", password: "errada-123456" } });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it("rotaciona refresh token e revoga a família em caso de reuso", async () => {
    const s = (await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { email: "editor@megalume.test", password: "senha-de-teste-123" } })).json();
    const r1 = await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { refreshToken: s.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const reuse = await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { refreshToken: s.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const r2 = await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { refreshToken: r1.json().refreshToken } });
    expect(r2.statusCode).toBe(401);
  });

  it("exige token e rejeita token adulterado", async () => {
    expect((await env.app.inject({ method: "GET", url: "/v1/assets" })).statusCode).toBe(401);
    const bad = tok.editor!.slice(0, -2) + "xx";
    expect((await env.app.inject({ method: "GET", url: "/v1/assets", headers: bearer(bad) })).statusCode).toBe(401);
  });
});

describe("fluxo rascunho → revisão → publicado", () => {
  let assetId: string;

  it("editor não pode criar asset; manifest inválido é recusado", async () => {
    const m = manifestFor(media.mogrt);
    expect((await env.app.inject({ method: "POST", url: "/v1/admin/assets", headers: bearer(tok.editor!), payload: { manifest: m } })).statusCode).toBe(403);
    const bad = await env.app.inject({ method: "POST", url: "/v1/admin/assets", headers: bearer(tok.designer!), payload: { manifest: { ...m, assets: [{ path: "../x.mogrt", sha256: "a".repeat(64), role: "template" }] } } });
    expect(bad.statusCode).toBe(422);
  });

  it("motion designer cria rascunho e envia arquivos verificados", async () => {
    const r = await env.app.inject({ method: "POST", url: "/v1/admin/assets", headers: bearer(tok.designer!), payload: { manifest: manifestFor(media.mogrt), category: "Títulos" } });
    expect(r.statusCode).toBe(201);
    assetId = r.json().assetId;
    expect(r.json().pendingUploads).toEqual(["template/title.mogrt", "preview/loop.mp4", "preview/poster.png"]);

    expect((await upload(assetId, "1.0.0", "template/title.mogrt", Buffer.concat([media.mogrt, Buffer.from("x")]))).statusCode).toBe(422); // hash diferente
    expect((await upload(assetId, "1.0.0", "preview/loop.mp4", media.png)).statusCode).toBe(422); // extensão enganosa
    expect((await upload(assetId, "1.0.0", "outro/arquivo.mp4", media.mp4)).statusCode).toBe(400); // fora do manifest

    const sub = await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/versions/1.0.0/submit`, headers: bearer(tok.designer!) });
    expect(sub.statusCode).toBe(422);
    expect(sub.json().error.details.missing).toHaveLength(3);

    for (const [p, b] of [["template/title.mogrt", media.mogrt], ["preview/loop.mp4", media.mp4], ["preview/poster.png", media.png]] as const) {
      const u = await upload(assetId, "1.0.0", p, b);
      expect(u.statusCode, u.body).toBe(201);
    }
  });

  it("rascunho não aparece para editor", async () => {
    const r = await env.app.inject({ method: "GET", url: "/v1/assets?query=rise", headers: bearer(tok.editor!) });
    expect(r.json().total).toBe(0);
    const d = await env.app.inject({ method: "GET", url: "/v1/assets?query=rise", headers: bearer(tok.designer!) });
    expect(d.json().total).toBe(1);
  });

  it("publicação sem preview gerado não avança; só curador publica", async () => {
    const sub = await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/versions/1.0.0/submit`, headers: bearer(tok.designer!) });
    expect(sub.statusCode).toBe(200);
    expect((await upload(assetId, "1.0.0", "preview/poster.png", media.png)).statusCode).toBe(409); // imutável

    const early = await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/publish`, headers: bearer(tok.curator!), payload: { semver: "1.0.0" } });
    expect(early.statusCode).toBe(422);

    await drainJobs();
    const detail = (await env.app.inject({ method: "GET", url: `/v1/admin/assets/${assetId}`, headers: bearer(tok.designer!) })).json();
    expect(detail.jobs[0].status).toBe("succeeded");
    const gen = detail.versions[0].files.filter((f: { path: string }) => f.path.startsWith("_generated/"));
    expect(gen.map((f: { mime: string }) => f.mime).sort()).toEqual(["image/webp", "video/mp4"]);

    expect((await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/publish`, headers: bearer(tok.designer!), payload: { semver: "1.0.0" } })).statusCode).toBe(403);
    const pub = await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/publish`, headers: bearer(tok.curator!), payload: { semver: "1.0.0" } });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().state).toBe("published");
    expect(pub.json().posterUrl).toMatch(/_generated\/poster\.webp/);
  });

  it("editor encontra (sem acento), favorita e baixa com hash verificável", async () => {
    const s = await env.app.inject({ method: "GET", url: "/v1/assets?query=titulo%20insti&host=premiere&aspectRatio=16:9", headers: bearer(tok.editor!) });
    expect(s.json().items.map((a: { id: string }) => a.id)).toEqual([assetId]);
    expect((await env.app.inject({ method: "GET", url: "/v1/assets?host=after-effects", headers: bearer(tok.editor!) })).json().total).toBe(0);

    expect((await env.app.inject({ method: "PUT", url: `/v1/favourites/${assetId}`, headers: bearer(tok.editor!) })).statusCode).toBe(204);
    expect((await env.app.inject({ method: "PUT", url: `/v1/favourites/${assetId}`, headers: bearer(tok.editor!) })).statusCode).toBe(204);
    expect((await env.app.inject({ method: "GET", url: "/v1/favourites", headers: bearer(tok.editor!) })).json()).toHaveLength(1);

    const t = await env.app.inject({ method: "POST", url: `/v1/assets/${assetId}/versions/1.0.0/download-ticket`, headers: bearer(tok.editor!) });
    const mogrt = t.json().files.find((f: { role: string }) => f.role === "template");
    const url = new URL(mogrt.url);
    const dl = await env.app.inject({ method: "GET", url: url.pathname + url.search });
    expect(dl.statusCode).toBe(200);
    expect(sha256Hex(dl.rawPayload)).toBe(mogrt.sha256);
    const part = await env.app.inject({ method: "GET", url: url.pathname + url.search, headers: { range: "bytes=10-" } });
    expect(part.statusCode).toBe(206);
    expect(Buffer.concat([dl.rawPayload.subarray(0, 10), part.rawPayload]).equals(dl.rawPayload)).toBe(true);
    expect((await env.app.inject({ method: "GET", url: url.pathname + url.search, headers: { range: "bytes=999999-" } })).statusCode).toBe(416);
    const tampered = await env.app.inject({ method: "GET", url: url.pathname + url.search.replace(/sig=./, "sig=Z") });
    expect(tampered.statusCode).toBe(403);
  });

  it("nova versão precisa ser maior; rollback volta à anterior", async () => {
    const same = await env.app.inject({ method: "POST", url: "/v1/admin/assets", headers: bearer(tok.designer!), payload: { manifest: manifestFor(media.mogrt) } });
    expect(same.statusCode).toBe(409);
    const v2 = await env.app.inject({ method: "POST", url: "/v1/admin/assets", headers: bearer(tok.designer!), payload: { manifest: manifestFor(media.mogrt, { version: "1.1.0" }), changelog: "Ajuste de easing" } });
    expect(v2.statusCode).toBe(201);
    for (const [p, b] of [["template/title.mogrt", media.mogrt], ["preview/loop.mp4", media.mp4], ["preview/poster.png", media.png]] as const) await upload(assetId, "1.1.0", p, b);
    await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/versions/1.1.0/submit`, headers: bearer(tok.designer!) });
    await drainJobs();
    const pub = await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/publish`, headers: bearer(tok.curator!), payload: { semver: "1.1.0" } });
    expect(pub.json().latestVersion).toBe("1.1.0");
    const rb = await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/rollback`, headers: bearer(tok.curator!), payload: { semver: "1.0.0" } });
    expect(rb.json().latestVersion).toBe("1.0.0");
    const audit = (await env.app.inject({ method: "GET", url: "/v1/admin/audit?action=asset.", headers: bearer(tok.admin!) })).json();
    expect(audit.map((a: { action: string }) => a.action)).toContain("asset.rollback");
  });

  it("catálogo incremental inclui manifest e marca descontinuados", async () => {
    const c1 = (await env.app.inject({ method: "GET", url: "/v1/catalog", headers: bearer(tok.editor!) })).json();
    expect(c1.items).toHaveLength(1);
    expect(c1.items[0].manifest.parameters[0].key).toBe("headline");
    const since = c1.serverTime;
    expect((await env.app.inject({ method: "GET", url: `/v1/catalog?since=${since}`, headers: bearer(tok.editor!) })).json().items).toHaveLength(0);
    await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/deprecate`, headers: bearer(tok.curator!) });
    const c2 = (await env.app.inject({ method: "GET", url: `/v1/catalog?since=${since}`, headers: bearer(tok.editor!) })).json();
    expect(c2.items[0].state).toBe("deprecated");
    expect((await env.app.inject({ method: "GET", url: "/v1/assets", headers: bearer(tok.editor!) })).json().total).toBe(0);
    await env.app.inject({ method: "POST", url: `/v1/admin/assets/${assetId}/restore`, headers: bearer(tok.curator!) });
  });

  it("pacote .mlpack é gerado com manifest assinado e verificável", async () => {
    const r = await env.app.inject({
      method: "POST",
      url: "/v1/admin/packs",
      headers: bearer(tok.curator!),
      payload: { slug: "titulos-institucionais", name: "Títulos Institucionais", version: "1.0.0", license: "megalume-internal", items: [{ assetId, semver: "1.1.0" }] },
    });
    expect(r.statusCode, r.body).toBe(202);
    await drainJobs();
    const list = (await env.app.inject({ method: "GET", url: "/v1/packs", headers: bearer(tok.editor!) })).json();
    expect(list.packs).toHaveLength(1);
    expect(list.packs[0]).toMatchObject({ assetCount: 1, types: ["title"], hosts: ["premiere"] });
    expect(list.packs[0].posterUrl).toMatch(/poster\.webp/);
    const packId = list.packs[0].id;
    const m = (await env.app.inject({ method: "GET", url: `/v1/packs/${packId}/manifest`, headers: bearer(tok.editor!) })).json();
    const key = (await env.app.inject({ method: "GET", url: "/v1/packs/signing-key" })).json();
    const ok = verify(null, Buffer.from(canonicalJson(m.manifest)), createPublicKey(key.publicKeyPem), Buffer.from(m.signature, "base64"));
    expect(ok).toBe(true);
    expect(m.manifest.assets[0].files.some((f: { path: string }) => f.path === "meg-title-rise-001/1.1.0/template/title.mogrt")).toBe(true);

    const t = (await env.app.inject({ method: "POST", url: `/v1/packs/${packId}/download-ticket`, headers: bearer(tok.editor!) })).json();
    const u = new URL(t.url);
    const dl = await env.app.inject({ method: "GET", url: u.pathname + u.search });
    expect(sha256Hex(dl.rawPayload)).toBe(t.sha256);
    expect(dl.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");

    await env.app.inject({ method: "POST", url: `/v1/admin/packs/${packId}/revoke`, headers: bearer(tok.curator!), payload: { reason: "teste kill-switch" } });
    const hb = (await env.app.inject({ method: "POST", url: "/v1/devices/heartbeat", headers: bearer(tok.editor!), payload: { name: "Estação 1", os: "macOS 15", installs: [{ packSlug: "titulos-institucionais", version: "1.0.0", status: "installed" }] } })).json();
    expect(hb.revokedPacks).toEqual([{ slug: "titulos-institucionais", version: "1.0.0" }]);
  });
});

describe("CORS", () => {
  it("preflight libera PUT/DELETE para origens configuradas", async () => {
    const r = await env.app.inject({ method: "OPTIONS", url: "/v1/favourites/x", headers: { origin: "http://localhost:5173", "access-control-request-method": "PUT" } });
    expect(r.headers["access-control-allow-methods"]).toContain("PUT");
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

describe("diagnóstico e administração", () => {
  it("exige consentimento e mascara caminhos pessoais", async () => {
    const no = await env.app.inject({ method: "POST", url: "/v1/diagnostics", headers: bearer(tok.editor!), payload: { payload: { a: 1 } } });
    expect(no.statusCode).toBe(400);
    const r = await env.app.inject({ method: "POST", url: "/v1/diagnostics", headers: bearer(tok.editor!), payload: { consent: true, payload: { log: "erro em /Users/joao/Projetos/x.prproj e C:\\Users\\maria\\a.mogrt" } } });
    expect(r.statusCode).toBe(201);
    const row = (await env.ctx.db.query("SELECT payload FROM diagnostics WHERE id = $1", [r.json().id])).rows[0];
    expect(row.payload.log).toBe("erro em /Users/<user>/Projetos/x.prproj e C:\\Users\\<user>\\a.mogrt");
  });

  it("admin gerencia usuários; desativar revoga sessão", async () => {
    const c = await env.app.inject({ method: "POST", url: "/v1/admin/users", headers: bearer(tok.admin!), payload: { name: "Novo", email: "novo@megalume.test", role: "editor", password: "outra-senha-forte" } });
    expect(c.statusCode).toBe(201);
    const s = (await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { email: "novo@megalume.test", password: "outra-senha-forte" } })).json();
    await env.app.inject({ method: "PATCH", url: `/v1/admin/users/${c.json().id}`, headers: bearer(tok.admin!), payload: { status: "disabled" } });
    expect((await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { refreshToken: s.refreshToken } })).statusCode).toBe(401);
    expect((await env.app.inject({ method: "GET", url: "/v1/admin/users", headers: bearer(tok.curator!) })).statusCode).toBe(403);
  });
});
