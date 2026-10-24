import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ASPECT_RATIOS, ASSET_STATES, ASSET_TYPES, HOSTS, can, tokenize, type DownloadTicketDTO, type Page, type AssetDTO } from "@motionhub/shared";
import type { AppContext } from "../context.js";
import { authenticate, requirePermission } from "../auth.js";
import { forbidden, notFound } from "../errors.js";
import { decodeCursor, encodeCursor, idParams, parse } from "../util.js";
import { ASSET_SELECT, loadVersions, signedFileUrl, toAssetDTO, type AssetRow, type FileRow } from "../assets-repo.js";
import { verifyUrlParams } from "../crypto.js";

const listQuery = z.object({
  query: z.string().max(200).optional(),
  host: z.enum(HOSTS).optional(),
  type: z.enum(ASSET_TYPES).optional(),
  tags: z.string().max(400).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  language: z.string().max(10).optional(),
  client: z.string().max(80).optional(),
  state: z.enum(ASSET_STATES).optional(),
  sort: z.enum(["relevance", "name", "updated"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export function assetRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** GET /v1/assets — busca paginada. Editores veem apenas publicados. */
  app.get("/v1/assets", async (req): Promise<Page<AssetDTO>> => {
    const p = requirePermission(ctx, req, "asset:read");
    const q = parse(listQuery, req.query);
    const where = ["a.org_id = $1", "a.deleted_at IS NULL"];
    const args: unknown[] = [p.orgId];
    const arg = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };

    const canSeeDrafts = can(p.role, "asset:create");
    if (q.state) {
      if (q.state !== "published" && !canSeeDrafts) throw forbidden();
      where.push(`a.state = ${arg(q.state)}`);
    } else if (!canSeeDrafts) {
      where.push(`a.state = 'published'`);
    }
    for (const term of tokenize(q.query ?? "")) where.push(`a.search_text LIKE ${arg(`%${term.replace(/[%_\\]/g, "\\$&")}%`)}`);
    if (q.host) where.push(`${arg(q.host)} = ANY(a.hosts)`);
    if (q.type) where.push(`a.type = ${arg(q.type)}`);
    if (q.aspectRatio) where.push(`a.aspect_ratio IN (${arg(q.aspectRatio)}, 'any')`);
    if (q.language) where.push(`(a.language IS NULL OR a.language = ${arg(q.language)})`);
    if (q.client) where.push(`lower(a.client) = lower(${arg(q.client)})`);
    if (q.tags) {
      const tags = q.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tags.length) where.push(`a.tags @> ${arg(tags)}::text[]`);
    }

    const whereSql = where.join(" AND ");
    const countArgs = [...args];
    const sort = q.sort ?? (q.query ? "relevance" : "name");
    const firstTerm = tokenize(q.query ?? "")[0];
    // Relevância: nome que começa com o primeiro termo vem antes; depois alfabético.
    const order =
      sort === "updated"
        ? "a.updated_at DESC, a.id"
        : sort === "relevance" && firstTerm
          ? `(lower(a.name) LIKE ${arg(`${firstTerm}%`)}) DESC, a.name, a.id`
          : "a.name, a.id";
    const offset = decodeCursor(q.cursor);
    const [{ rows }, count] = await Promise.all([
      ctx.db.query<AssetRow>(`${ASSET_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${offset}`, args),
      ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM assets a WHERE ${whereSql}`, countArgs),
    ]);
    const total = Number(count.rows[0]!.n);
    return {
      items: rows.map((r) => toAssetDTO(ctx, r)),
      total,
      nextCursor: offset + rows.length < total ? encodeCursor(offset + rows.length) : null,
    };
  });

  /**
   * GET /v1/catalog?since= — sincronização incremental do índice local (offline-first).
   * Inclui descontinuados para que o cliente os marque, sem apagar de projetos antigos.
   */
  app.get("/v1/catalog", async (req) => {
    const p = requirePermission(ctx, req, "asset:read");
    const { since } = parse(z.object({ since: z.iso.datetime().optional() }), req.query);
    const args: unknown[] = [p.orgId];
    let cond = "a.org_id = $1 AND a.state IN ('published','deprecated') AND a.current_version_id IS NOT NULL";
    if (since) {
      args.push(since);
      cond += " AND a.updated_at > $2";
    }
    const serverTime = new Date().toISOString();
    const { rows } = await ctx.db.query<AssetRow & { manifest: unknown; deleted_at: Date | null }>(
      `SELECT x.*, v.manifest FROM (${ASSET_SELECT} WHERE ${cond}) x JOIN asset_versions v ON v.id = x.current_version_id ORDER BY x.updated_at`,
      args,
    );
    return {
      serverTime,
      items: rows.map((r) => ({ ...toAssetDTO(ctx, r), deleted: r.deleted_at !== null, manifest: r.manifest })),
    };
  });

  app.get("/v1/assets/:id", async (req) => {
    const p = requirePermission(ctx, req, "asset:read");
    const { id } = parse(idParams, req.params);
    const row = (await ctx.db.query<AssetRow>(`${ASSET_SELECT} WHERE a.id = $1 AND a.org_id = $2 AND a.deleted_at IS NULL`, [id, p.orgId])).rows[0];
    if (!row || (row.state !== "published" && !can(p.role, "asset:create"))) throw notFound("Asset");
    return toAssetDTO(ctx, row);
  });

  /** GET /v1/assets/:id/versions — versões e compatibilidade. */
  app.get("/v1/assets/:id/versions", async (req) => {
    const p = requirePermission(ctx, req, "asset:read");
    const { id } = parse(idParams, req.params);
    const a = (await ctx.db.query<{ state: string }>("SELECT state FROM assets WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL", [id, p.orgId])).rows[0];
    if (!a || (a.state !== "published" && a.state !== "deprecated" && !can(p.role, "asset:create"))) throw notFound("Asset");
    const versions = await loadVersions(ctx.db, id);
    return can(p.role, "asset:create") ? versions : versions.filter((v) => v.status === "published");
  });

  /** POST /v1/assets/:id/versions/:semver/download-ticket — URLs temporárias por arquivo, com hash para verificação. */
  app.post("/v1/assets/:id/versions/:semver/download-ticket", async (req) => {
    const p = requirePermission(ctx, req, "asset:apply");
    const { id, semver } = parse(z.object({ id: z.uuid(), semver: z.string().max(40) }), req.params);
    const { rows } = await ctx.db.query<FileRow & { vstatus: string }>(
      `SELECT f.*, v.status AS vstatus FROM asset_files f
       JOIN asset_versions v ON v.id = f.version_id JOIN assets a ON a.id = v.asset_id
       WHERE a.id = $1 AND a.org_id = $2 AND v.semver = $3 AND a.deleted_at IS NULL`,
      [id, p.orgId, semver],
    );
    if (!rows.length) throw notFound("Versão");
    if (rows[0]!.vstatus !== "published" && !can(p.role, "asset:create")) throw notFound("Versão");
    const files: Array<DownloadTicketDTO & { path: string; role: string }> = rows.map((f) => {
      const { url, expiresAt } = signedFileUrl(ctx, f.storage_key, ctx.config.downloadTicketTtlSec);
      return { path: f.path, role: f.role, url, expiresAt: new Date(expiresAt * 1000).toISOString(), sha256: f.sha256, bytes: Number(f.bytes) };
    });
    return { assetId: id, version: semver, files };
  });

  /** GET /v1/files/* — entrega de arquivo por link efêmero assinado (M13). */
  app.get("/v1/files/*", async (req, reply) => {
    const key = (req.params as { "*": string })["*"];
    const { exp, sig } = parse(z.object({ exp: z.coerce.number().int(), sig: z.string().max(100) }), req.query);
    if (!verifyUrlParams(key, exp, sig, ctx.config.jwtSecret)) throw forbidden("Link expirado ou inválido.");
    if (!(await ctx.storage.exists(key))) throw notFound("Arquivo");
    const f = (await ctx.db.query<{ mime: string; sha256: string }>(
      `SELECT mime, sha256 FROM asset_files WHERE storage_key = $1 UNION ALL SELECT 'application/zip', archive_sha256 FROM packs WHERE archive_key = $1 LIMIT 1`,
      [key],
    )).rows[0];
    reply.header("Content-Type", f?.mime ?? "application/octet-stream");
    if (f?.sha256) reply.header("ETag", `"${f.sha256}"`);
    reply.header("Cache-Control", "private, max-age=3600, immutable");
    return reply.send(ctx.storage.get(key));
  });

  // ---- Favoritos (US-005) ----
  app.get("/v1/favourites", async (req) => {
    const p = requirePermission(ctx, req, "favourite:write");
    const { rows } = await ctx.db.query<{ asset_id: string; created_at: Date }>(
      "SELECT asset_id, created_at FROM favourites WHERE user_id = $1 ORDER BY created_at DESC",
      [p.userId],
    );
    return rows.map((r) => ({ assetId: r.asset_id, createdAt: r.created_at.toISOString() }));
  });

  app.put("/v1/favourites/:id", async (req, reply) => {
    const p = requirePermission(ctx, req, "favourite:write");
    const { id } = parse(idParams, req.params);
    const r = await ctx.db.query(
      `INSERT INTO favourites (user_id, asset_id) SELECT $1, id FROM assets WHERE id = $2 AND org_id = $3 ON CONFLICT DO NOTHING`,
      [p.userId, id, p.orgId],
    );
    if (r.rowCount === 0) {
      const exists = await ctx.db.query("SELECT 1 FROM assets WHERE id = $1 AND org_id = $2", [id, p.orgId]);
      if (!exists.rowCount) throw notFound("Asset");
    }
    return reply.status(204).send();
  });

  app.delete("/v1/favourites/:id", async (req, reply) => {
    const p = requirePermission(ctx, req, "favourite:write");
    const { id } = parse(idParams, req.params);
    await ctx.db.query("DELETE FROM favourites WHERE user_id = $1 AND asset_id = $2", [p.userId, id]);
    return reply.status(204).send();
  });

  /** POST /v1/usage — evento de uso SEM conteúdo do projeto (§6, §9). */
  app.post("/v1/usage", async (req, reply) => {
    const p = authenticate(ctx, req);
    const body = parse(
      z.object({ assetVersionId: z.uuid(), host: z.enum(HOSTS), action: z.enum(["apply", "apply_failed", "preview", "download"]) }),
      req.body,
    );
    await ctx.db.query(
      `INSERT INTO usage_events (org_id, actor_id, asset_version_id, host, action)
       SELECT $1, $2, v.id, $4, $5 FROM asset_versions v JOIN assets a ON a.id = v.asset_id WHERE v.id = $3 AND a.org_id = $1`,
      [p.orgId, p.userId, body.assetVersionId, body.host, body.action],
    );
    return reply.status(204).send();
  });
}
