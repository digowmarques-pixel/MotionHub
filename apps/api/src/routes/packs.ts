import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { compareSemver, isSemver } from "@motionhub/shared";
import type { AppContext } from "../context.js";
import { audit } from "../context.js";
import { requirePermission } from "../auth.js";
import { conflict, notFound, unprocessable } from "../errors.js";
import { idParams, parse } from "../util.js";
import { withTx } from "../db.js";
import { enqueue } from "../jobs/queue.js";
import { signedFileUrl } from "../assets-repo.js";

interface PackRow {
  id: string;
  slug: string;
  name: string;
  version: string;
  license: string;
  status: string;
  signed_manifest: unknown;
  signature: string | null;
  archive_key: string | null;
  archive_sha256: string | null;
  archive_bytes: string | null;
  created_at: Date;
}

const toPackDTO = (p: PackRow) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  version: p.version,
  license: p.license,
  status: p.status,
  archiveSha256: p.archive_sha256,
  archiveBytes: p.archive_bytes === null ? null : Number(p.archive_bytes),
  createdAt: p.created_at.toISOString(),
});

/** Tipos ordenados do mais frequente ao menos frequente (o primeiro define a seção na vitrine). */
function byFrequency(types: string[]): string[] {
  const n = new Map<string, number>();
  for (const t of types) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.keys()].sort((a, b) => n.get(b)! - n.get(a)! || a.localeCompare(b));
}

export function packRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Chave pública para os clientes verificarem a assinatura dos pacotes. */
  app.get("/v1/packs/signing-key", async () => {
    if (!ctx.signer) throw notFound("Chave de assinatura");
    return { keyId: ctx.signer.keyId, algorithm: "ed25519", publicKeyPem: ctx.signer.publicKeyPem };
  });

  /** Lista a versão mais recente pronta de cada pacote (para o gerenciador detectar atualizações). */
  app.get("/v1/packs", async (req) => {
    const p = requirePermission(ctx, req, "asset:read");
    const { rows } = await ctx.db.query<PackRow>(
      `SELECT * FROM packs WHERE org_id = $1 AND status IN ('ready','revoked') ORDER BY slug, created_at DESC`,
      [p.orgId],
    );
    const latest = new Map<string, PackRow>();
    const revoked: Array<{ slug: string; version: string }> = [];
    for (const r of rows) {
      if (r.status === "revoked") {
        revoked.push({ slug: r.slug, version: r.version });
        continue;
      }
      const cur = latest.get(r.slug);
      if (!cur || compareSemver(r.version, cur.version) > 0) latest.set(r.slug, r);
    }
    const ids = [...latest.values()].map((r) => r.id);
    // Resumo para a vitrine do Gerenciador: quantidade, tipos, hosts e miniatura do primeiro item.
    const summary = new Map(
      (
        await ctx.db.query<{ pack_id: string; n: string; types: string[]; hosts: string[]; poster_key: string | null }>(
          `SELECT pi.pack_id, count(*) AS n,
             array_agg(a.type) AS types,
             (SELECT coalesce(array_agg(DISTINCT h->>'name'), '{}') FROM pack_items pi2
                JOIN asset_versions v2 ON v2.id = pi2.version_id, jsonb_array_elements(v2.host_targets) h
                WHERE pi2.pack_id = pi.pack_id) AS hosts,
             (array_agg(pf.storage_key ORDER BY a.name) FILTER (WHERE pf.storage_key IS NOT NULL))[1] AS poster_key
           FROM pack_items pi
           JOIN asset_versions v ON v.id = pi.version_id
           JOIN assets a ON a.id = v.asset_id
           LEFT JOIN LATERAL (SELECT storage_key FROM asset_files f WHERE f.version_id = v.id AND f.role = 'poster' AND f.generated LIMIT 1) pf ON true
           WHERE pi.pack_id = ANY($1) GROUP BY pi.pack_id`,
          [ids],
        )
      ).rows.map((r) => [r.pack_id, r]),
    );
    return {
      packs: [...latest.values()].map((r) => {
        const s = summary.get(r.id);
        return {
          ...toPackDTO(r),
          assetCount: s ? Number(s.n) : 0,
          types: byFrequency(s?.types ?? []),
          hosts: s?.hosts ?? [],
          posterUrl: s?.poster_key ? signedFileUrl(ctx, s.poster_key, 6 * 3600).url : null,
        };
      }),
      revoked,
    };
  });

  /** GET /v1/packs/:id/manifest — metadados assinados. */
  app.get("/v1/packs/:id/manifest", async (req, reply) => {
    const p = requirePermission(ctx, req, "asset:read");
    const { id } = parse(idParams, req.params);
    const pack = (await ctx.db.query<PackRow>("SELECT * FROM packs WHERE id = $1 AND org_id = $2", [id, p.orgId])).rows[0];
    if (!pack || pack.status !== "ready" || !pack.signed_manifest) throw notFound("Pacote");
    const etag = `"${pack.archive_sha256}"`;
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    reply.header("ETag", etag);
    return { manifest: pack.signed_manifest, signature: pack.signature, keyId: ctx.signer?.keyId, archive: { sha256: pack.archive_sha256, bytes: Number(pack.archive_bytes) } };
  });

  /** POST /v1/packs/:id/download-ticket — URL temporária do .mlpack. */
  app.post("/v1/packs/:id/download-ticket", async (req) => {
    const p = requirePermission(ctx, req, "asset:apply");
    const { id } = parse(idParams, req.params);
    const pack = (await ctx.db.query<PackRow>("SELECT * FROM packs WHERE id = $1 AND org_id = $2", [id, p.orgId])).rows[0];
    if (!pack || pack.status !== "ready" || !pack.archive_key) throw notFound("Pacote");
    const { url, expiresAt } = signedFileUrl(ctx, pack.archive_key, ctx.config.downloadTicketTtlSec);
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString(), sha256: pack.archive_sha256, bytes: Number(pack.archive_bytes) };
  });

  /** POST /v1/admin/packs — monta pacote com versões publicadas; o .mlpack é gerado por job. */
  app.post("/v1/admin/packs", async (req, reply) => {
    const p = requirePermission(ctx, req, "asset:publish");
    const body = parse(
      z.object({
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
        name: z.string().min(1).max(120),
        version: z.string().refine(isSemver, "semver inválido"),
        license: z.string().min(1).max(200),
        items: z.array(z.object({ assetId: z.uuid(), semver: z.string() })).min(1).max(500),
      }),
      req.body,
    );
    if (!ctx.signer) throw unprocessable("Servidor sem chave de assinatura configurada (PACK_SIGNING_KEY_PATH).");
    const result = await withTx(ctx.db, async (tx) => {
      const prev = (await tx.query<{ version: string }>("SELECT version FROM packs WHERE org_id = $1 AND slug = $2", [p.orgId, body.slug])).rows;
      const higher = prev.find((r) => compareSemver(r.version, body.version) >= 0);
      if (higher) throw conflict(`Versão do pacote precisa ser maior que ${higher.version}.`);
      const versionIds: string[] = [];
      for (const it of body.items) {
        const v = (
          await tx.query<{ id: string; status: string }>(
            `SELECT v.id, v.status FROM asset_versions v JOIN assets a ON a.id = v.asset_id WHERE a.id = $1 AND a.org_id = $2 AND v.semver = $3`,
            [it.assetId, p.orgId, it.semver],
          )
        ).rows[0];
        if (!v) throw unprocessable(`Versão ${it.semver} do asset ${it.assetId} não existe.`);
        if (v.status !== "published") throw unprocessable(`Versão ${it.semver} do asset ${it.assetId} não está publicada.`);
        versionIds.push(v.id);
      }
      const pack = (
        await tx.query<{ id: string }>(
          `INSERT INTO packs (org_id, slug, name, version, license, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [p.orgId, body.slug, body.name, body.version, body.license, p.userId],
        )
      ).rows[0]!;
      for (const vid of new Set(versionIds)) await tx.query("INSERT INTO pack_items (pack_id, version_id) VALUES ($1,$2)", [pack.id, vid]);
      const jobId = await enqueue(tx, "pack_build", { packId: pack.id });
      await audit(tx, { orgId: p.orgId, actorId: p.userId, action: "pack.create", targetType: "pack", targetId: pack.id, data: { slug: body.slug, version: body.version } });
      return { packId: pack.id, jobId };
    });
    return reply.status(202).send(result);
  });

  /** Kill-switch (M15): revoga pacote inseguro; clientes param de instalá-lo, projetos não são apagados. */
  app.post("/v1/admin/packs/:id/revoke", async (req) => {
    const p = requirePermission(ctx, req, "asset:deprecate");
    const { id } = parse(idParams, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(1).max(2000) }), req.body);
    const r = await ctx.db.query("UPDATE packs SET status = 'revoked' WHERE id = $1 AND org_id = $2 RETURNING id", [id, p.orgId]);
    if (!r.rowCount) throw notFound("Pacote");
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "pack.revoke", targetType: "pack", targetId: id, data: { reason } });
    return { status: "revoked" };
  });

  app.get("/v1/admin/packs", async (req) => {
    const p = requirePermission(ctx, req, "asset:publish");
    const { rows } = await ctx.db.query<PackRow>("SELECT * FROM packs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 200", [p.orgId]);
    return rows.map(toPackDTO);
  });
}
