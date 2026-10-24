import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import { compareSemver, isSafeRelativePath, validateManifest, type PresetManifest } from "@motionhub/shared";
import type { AppContext } from "../context.js";
import { audit } from "../context.js";
import { requirePermission } from "../auth.js";
import { badRequest, conflict, notFound, unprocessable } from "../errors.js";
import { idParams, parse } from "../util.js";
import { withTx } from "../db.js";
import { ASSET_SELECT, buildSearchText, loadVersions, toAssetDTO, type AssetRow, type FileRow, type VersionRow } from "../assets-repo.js";
import { checkFileType } from "../sniff.js";
import { enqueue } from "../jobs/queue.js";

const createBody = z.object({
  manifest: z.unknown(),
  changelog: z.string().max(4000).optional(),
  category: z.string().max(60).optional(),
  teamId: z.uuid().optional(),
});

const versionParams = z.object({ id: z.uuid(), semver: z.string().max(40) });

/** Todos os caminhos que a versão espera receber por upload. */
export function expectedFiles(m: PresetManifest): Map<string, { sha256?: string; role: string; bytes?: number }> {
  const out = new Map<string, { sha256?: string; role: string; bytes?: number }>();
  for (const a of m.assets) out.set(a.path, { sha256: a.sha256, role: a.role, bytes: a.bytes });
  if (!out.has(m.preview.path)) out.set(m.preview.path, { role: "preview" });
  if (!out.has(m.preview.poster)) out.set(m.preview.poster, { role: "poster" });
  return out;
}

export function adminAssetRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Upload como fluxo binário bruto (sem buffer em memória).
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));

  const loadAsset = async (id: string, orgId: string): Promise<AssetRow> => {
    const row = (await ctx.db.query<AssetRow>(`${ASSET_SELECT} WHERE a.id = $1 AND a.org_id = $2 AND a.deleted_at IS NULL`, [id, orgId])).rows[0];
    if (!row) throw notFound("Asset");
    return row;
  };

  const loadVersion = async (assetId: string, semver: string): Promise<VersionRow> => {
    const v = (await ctx.db.query<VersionRow>("SELECT * FROM asset_versions WHERE asset_id = $1 AND semver = $2", [assetId, semver])).rows[0];
    if (!v) throw notFound("Versão");
    return v;
  };

  /**
   * POST /v1/admin/assets — cria rascunho a partir do manifest.
   * Se o id do manifest já existir, cria nova versão (precisa ser maior que as existentes).
   */
  app.post("/v1/admin/assets", async (req, reply) => {
    const p = requirePermission(ctx, req, "asset:create");
    const body = parse(createBody, req.body);
    const v = validateManifest(body.manifest);
    if (!v.ok) throw unprocessable("Manifest inválido.", v.issues);
    const m = v.manifest;

    const result = await withTx(ctx.db, async (tx) => {
      let asset = (await tx.query<{ id: string; state: string }>("SELECT id, state FROM assets WHERE org_id = $1 AND slug = $2 FOR UPDATE", [p.orgId, m.id])).rows[0];
      const meta = {
        name: m.name,
        tags: m.tags,
        synonyms: m.synonyms,
        summary: m.summary ?? null,
        client: m.client ?? null,
        category: body.category ?? null,
        slug: m.id,
      };
      if (!asset) {
        asset = (
          await tx.query<{ id: string; state: string }>(
            `INSERT INTO assets (org_id, team_id, slug, name, type, summary, tags, synonyms, category, client, aspect_ratio, language, hosts, rights, creator_id, search_text)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, state`,
            [p.orgId, body.teamId ?? null, m.id, m.name, m.type, meta.summary, m.tags, m.synonyms, meta.category, meta.client, m.aspectRatio, m.language ?? null, m.hosts.map((h) => h.name), m.license, p.userId, buildSearchText(meta)],
          )
        ).rows[0]!;
      } else {
        const existing = (await tx.query<{ semver: string }>("SELECT semver FROM asset_versions WHERE asset_id = $1", [asset.id])).rows;
        const higher = existing.find((e) => compareSemver(e.semver, m.version) >= 0);
        if (higher) throw conflict(`A versão ${m.version} precisa ser maior que a existente ${higher.semver}.`);
      }
      const version = (
        await tx.query<{ id: string }>(
          `INSERT INTO asset_versions (asset_id, semver, host_targets, manifest, manifest_schema, changelog, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [asset.id, m.version, JSON.stringify(m.hosts), JSON.stringify(m), m.schemaVersion, body.changelog ?? null, p.userId],
        )
      ).rows[0]!;
      await audit(tx, { orgId: p.orgId, actorId: p.userId, action: "asset.version.create", targetType: "asset", targetId: asset.id, data: { semver: m.version } });
      return { assetId: asset.id, versionId: version.id };
    });

    return reply.status(201).send({
      ...result,
      semver: m.version,
      pendingUploads: [...expectedFiles(m).keys()],
    });
  });

  /** PATCH /v1/admin/assets/:id — metadados de catálogo (taxonomia, cliente, resumo). */
  app.patch("/v1/admin/assets/:id", async (req) => {
    const p = requirePermission(ctx, req, "asset:edit_params");
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        name: z.string().min(1).max(120).optional(),
        summary: z.string().max(500).nullable().optional(),
        tags: z.array(z.string().min(1).max(40)).max(50).optional(),
        synonyms: z.array(z.string().min(1).max(40)).max(50).optional(),
        category: z.string().max(60).nullable().optional(),
        client: z.string().max(80).nullable().optional(),
      }),
      req.body,
    );
    const a = await loadAsset(id, p.orgId);
    const next = {
      name: body.name ?? a.name,
      summary: body.summary !== undefined ? body.summary : a.summary,
      tags: body.tags ?? a.tags,
      synonyms: body.synonyms ?? a.synonyms,
      category: body.category !== undefined ? body.category : a.category,
      client: body.client !== undefined ? body.client : a.client,
      slug: a.slug,
    };
    await ctx.db.query(
      `UPDATE assets SET name=$2, summary=$3, tags=$4, synonyms=$5, category=$6, client=$7, search_text=$8, updated_at=now() WHERE id=$1`,
      [id, next.name, next.summary, next.tags, next.synonyms, next.category, next.client, buildSearchText(next)],
    );
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "asset.update", targetType: "asset", targetId: id, data: body });
    return toAssetDTO(ctx, await loadAsset(id, p.orgId));
  });

  /**
   * PUT /v1/admin/assets/:id/versions/:semver/files/<caminho> — upload de um arquivo da versão.
   * O caminho deve constar no manifest; o hash SHA-256 e o formato real são verificados.
   */
  app.put("/v1/admin/assets/:id/versions/:semver/files/*", { bodyLimit: ctx.config.maxUploadBytes }, async (req, reply) => {
    const p = requirePermission(ctx, req, "asset:create");
    const params = req.params as { id: string; semver: string; "*": string };
    const { id, semver } = parse(versionParams, params);
    const path = decodeURIComponent(params["*"]);
    if (!isSafeRelativePath(path)) throw badRequest("Caminho de arquivo inválido.");
    await loadAsset(id, p.orgId);
    const v = await loadVersion(id, semver);
    if (v.status !== "draft") throw conflict("Versão já enviada para revisão ou publicada; é imutável. Crie uma nova versão.");
    const expected = expectedFiles(v.manifest).get(path);
    if (!expected) throw badRequest(`O arquivo "${path}" não consta no manifest desta versão.`);
    if (!(req.body instanceof Readable)) throw badRequest("Envie o arquivo com Content-Type: application/octet-stream.");

    // Lê o início do fluxo para identificar o formato pelo conteúdo antes de gravar.
    const { head, stream } = await peek(req.body, 64);
    const type = checkFileType(path, head);
    if (!type.ok) throw unprocessable(`Arquivo recusado: ${type.reason}.`);

    const key = `assets/${id}/${v.id}/${path}`;
    const stored = await ctx.storage.put(key, stream, { maxBytes: ctx.config.maxUploadBytes });
    if (expected.sha256 && stored.sha256 !== expected.sha256) {
      await ctx.storage.remove(key);
      throw unprocessable("SHA-256 do arquivo não confere com o manifest.", { expected: expected.sha256, received: stored.sha256 });
    }
    if (expected.bytes !== undefined && stored.bytes !== expected.bytes) {
      await ctx.storage.remove(key);
      throw unprocessable("Tamanho do arquivo não confere com o manifest.");
    }
    await ctx.db.query(
      `INSERT INTO asset_files (version_id, role, path, mime, bytes, sha256, storage_key) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (version_id, path) DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256, storage_key = EXCLUDED.storage_key`,
      [v.id, expected.role, path, type.mime, stored.bytes, stored.sha256, key],
    );
    return reply.status(201).send({ path, bytes: stored.bytes, sha256: stored.sha256, mime: type.mime });
  });

  /** POST .../submit — conclui upload, envia para revisão e agenda geração de preview padronizado. */
  app.post("/v1/admin/assets/:id/versions/:semver/submit", async (req) => {
    const p = requirePermission(ctx, req, "asset:request_review");
    const { id, semver } = parse(versionParams, req.params);
    const a = await loadAsset(id, p.orgId);
    const v = await loadVersion(id, semver);
    if (v.status !== "draft") throw conflict("Versão já foi enviada.");
    const files = (await ctx.db.query<FileRow>("SELECT * FROM asset_files WHERE version_id = $1", [v.id])).rows;
    const have = new Set(files.map((f) => f.path));
    const missing = [...expectedFiles(v.manifest).keys()].filter((k) => !have.has(k));
    if (missing.length) throw unprocessable("Faltam arquivos para esta versão.", { missing });

    const jobId = await withTx(ctx.db, async (tx) => {
      await tx.query("UPDATE asset_versions SET status = 'validated' WHERE id = $1", [v.id]);
      if (a.state === "draft") await tx.query("UPDATE assets SET state = 'review', updated_at = now() WHERE id = $1", [id]);
      const job = await enqueue(tx, "preview", { versionId: v.id });
      await audit(tx, { orgId: p.orgId, actorId: p.userId, action: "asset.version.submit", targetType: "asset", targetId: id, data: { semver, jobId: job } });
      return job;
    });
    return { status: "validated", previewJobId: jobId };
  });

  /** POST .../reject — curador devolve para rascunho com motivo. */
  app.post("/v1/admin/assets/:id/versions/:semver/reject", async (req) => {
    const p = requirePermission(ctx, req, "asset:publish");
    const { id, semver } = parse(versionParams, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(1).max(2000) }), req.body);
    const a = await loadAsset(id, p.orgId);
    const v = await loadVersion(id, semver);
    if (v.status !== "validated") throw conflict("Apenas versões em revisão podem ser devolvidas.");
    await withTx(ctx.db, async (tx) => {
      await tx.query("UPDATE asset_versions SET status = 'draft' WHERE id = $1", [v.id]);
      await tx.query("DELETE FROM asset_files WHERE version_id = $1 AND generated", [v.id]);
      if (a.state === "review") await tx.query("UPDATE assets SET state = 'draft', updated_at = now() WHERE id = $1", [id]);
      await audit(tx, { orgId: p.orgId, actorId: p.userId, action: "asset.version.reject", targetType: "asset", targetId: id, data: { semver, reason } });
    });
    return { status: "draft" };
  });

  /** POST /v1/admin/assets/:id/publish — só curadores; exige preview padronizado gerado. */
  app.post("/v1/admin/assets/:id/publish", async (req) => {
    const p = requirePermission(ctx, req, "asset:publish");
    const { id } = parse(idParams, req.params);
    const { semver } = parse(z.object({ semver: z.string().max(40) }), req.body);
    await loadAsset(id, p.orgId);
    const v = await loadVersion(id, semver);
    if (v.status === "published") throw conflict("Versão já publicada.");
    if (v.status !== "validated") throw conflict("A versão precisa estar em revisão (validada) para ser publicada.");
    const gen = (await ctx.db.query<{ role: string }>("SELECT role FROM asset_files WHERE version_id = $1 AND generated", [v.id])).rows.map((r) => r.role);
    if (!gen.includes("preview") || !gen.includes("poster")) {
      throw unprocessable("Preview padronizado ainda não foi gerado. Aguarde o processamento ou verifique o job.");
    }
    await withTx(ctx.db, async (tx) => {
      await tx.query("UPDATE asset_versions SET status = 'published', release_date = now() WHERE id = $1", [v.id]);
      await tx.query("UPDATE assets SET state = 'published', current_version_id = $2, updated_at = now() WHERE id = $1", [id, v.id]);
      await audit(tx, { orgId: p.orgId, actorId: p.userId, action: "asset.publish", targetType: "asset", targetId: id, data: { semver } });
    });
    return toAssetDTO(ctx, await loadAsset(id, p.orgId));
  });

  /** POST /v1/admin/assets/:id/rollback — volta a versão corrente para outra já publicada. */
  app.post("/v1/admin/assets/:id/rollback", async (req) => {
    const p = requirePermission(ctx, req, "asset:publish");
    const { id } = parse(idParams, req.params);
    const { semver } = parse(z.object({ semver: z.string().max(40) }), req.body);
    const a = await loadAsset(id, p.orgId);
    const v = await loadVersion(id, semver);
    if (v.status !== "published") throw conflict("Só é possível voltar para uma versão publicada.");
    await ctx.db.query("UPDATE assets SET current_version_id = $2, updated_at = now() WHERE id = $1", [id, v.id]);
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "asset.rollback", targetType: "asset", targetId: id, data: { from: a.latest_semver, to: semver } });
    return toAssetDTO(ctx, await loadAsset(id, p.orgId));
  });

  /** Descontinuar: some da busca, mas continua disponível para projetos existentes (§15.22). */
  app.post("/v1/admin/assets/:id/deprecate", async (req) => {
    const p = requirePermission(ctx, req, "asset:deprecate");
    const { id } = parse(idParams, req.params);
    const a = await loadAsset(id, p.orgId);
    if (a.state !== "published") throw conflict("Apenas assets publicados podem ser descontinuados.");
    await ctx.db.query("UPDATE assets SET state = 'deprecated', updated_at = now() WHERE id = $1", [id]);
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "asset.deprecate", targetType: "asset", targetId: id });
    return toAssetDTO(ctx, await loadAsset(id, p.orgId));
  });

  app.post("/v1/admin/assets/:id/restore", async (req) => {
    const p = requirePermission(ctx, req, "asset:deprecate");
    const { id } = parse(idParams, req.params);
    const a = await loadAsset(id, p.orgId);
    if (a.state !== "deprecated") throw conflict("Asset não está descontinuado.");
    await ctx.db.query("UPDATE assets SET state = 'published', updated_at = now() WHERE id = $1", [id]);
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "asset.restore", targetType: "asset", targetId: id });
    return toAssetDTO(ctx, await loadAsset(id, p.orgId));
  });

  /** Exclusão lógica (M12): mantém versões e arquivos para auditoria e projetos antigos. */
  app.delete("/v1/admin/assets/:id", async (req, reply) => {
    const p = requirePermission(ctx, req, "team:manage");
    const { id } = parse(idParams, req.params);
    await loadAsset(id, p.orgId);
    await ctx.db.query("UPDATE assets SET deleted_at = now(), updated_at = now() WHERE id = $1", [id]);
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "asset.delete", targetType: "asset", targetId: id });
    return reply.status(204).send();
  });

  app.get("/v1/admin/assets/:id", async (req) => {
    const p = requirePermission(ctx, req, "asset:create");
    const { id } = parse(idParams, req.params);
    const a = await loadAsset(id, p.orgId);
    const jobs = (
      await ctx.db.query(
        `SELECT j.id, j.kind, j.status, j.progress, j.retries, j.error_code, j.error_detail, j.updated_at, v.semver
         FROM jobs j JOIN asset_versions v ON v.id = (j.input->>'versionId')::uuid
         WHERE v.asset_id = $1 ORDER BY j.created_at DESC LIMIT 20`,
        [id],
      )
    ).rows;
    return { asset: toAssetDTO(ctx, a), versions: await loadVersions(ctx.db, id), jobs };
  });
}

/**
 * Lê os primeiros bytes do fluxo sem consumi-lo: os bytes são devolvidos com unshift.
 * Se o fluxo terminar antes (arquivo pequeno), devolve um novo fluxo com o conteúdo inteiro.
 */
function peek(stream: Readable, n: number): Promise<{ head: Buffer; stream: Readable }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    const cleanup = () => {
      stream.off("readable", onReadable);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };
    const onReadable = () => {
      let c: Buffer | null;
      while ((c = stream.read() as Buffer | null) !== null) {
        chunks.push(c);
        len += c.length;
        if (len >= n) {
          cleanup();
          const all = Buffer.concat(chunks);
          stream.unshift(all);
          return resolve({ head: all.subarray(0, n), stream });
        }
      }
    };
    const onEnd = () => {
      cleanup();
      const all = Buffer.concat(chunks);
      resolve({ head: all, stream: Readable.from([all]) });
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    stream.on("readable", onReadable);
    stream.once("end", onEnd);
    stream.once("error", onError);
  });
}
