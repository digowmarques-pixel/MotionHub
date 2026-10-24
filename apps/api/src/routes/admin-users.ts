import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROLES } from "@motionhub/shared";
import type { AppContext } from "../context.js";
import { audit } from "../context.js";
import { requirePermission } from "../auth.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { hashPassword } from "../crypto.js";
import { idParams, parse } from "../util.js";
import { toUserDTO } from "./auth.js";

const password = z.string().min(12, "senha precisa de ao menos 12 caracteres").max(200);

export function adminUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/v1/admin/users", async (req) => {
    const p = requirePermission(ctx, req, "user:manage");
    const { rows } = await ctx.db.query("SELECT id, org_id, name, email, role, status, created_at FROM users WHERE org_id = $1 ORDER BY name", [p.orgId]);
    return rows.map(toUserDTO);
  });

  app.post("/v1/admin/users", async (req, reply) => {
    const p = requirePermission(ctx, req, "user:manage");
    const b = parse(z.object({ name: z.string().min(1).max(120), email: z.email(), role: z.enum(ROLES), password }), req.body);
    try {
      const { rows } = await ctx.db.query(
        `INSERT INTO users (org_id, name, email, role, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, org_id, name, email, role, status, created_at`,
        [p.orgId, b.name, b.email, b.role, await hashPassword(b.password)],
      );
      await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "user.create", targetType: "user", targetId: rows[0].id, data: { role: b.role } });
      return reply.status(201).send(toUserDTO(rows[0]));
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("Já existe usuário com este e-mail.");
      throw e;
    }
  });

  /** Alterar papel/status; desativar revoga as sessões (§9 revogação de tokens). */
  app.patch("/v1/admin/users/:id", async (req) => {
    const p = requirePermission(ctx, req, "user:manage");
    const { id } = parse(idParams, req.params);
    const b = parse(z.object({ role: z.enum(ROLES).optional(), status: z.enum(["active", "disabled"]).optional(), password: password.optional() }), req.body);
    if (id === p.userId && (b.role || b.status === "disabled")) throw badRequest("Você não pode alterar o próprio papel ou se desativar.");
    const { rows } = await ctx.db.query(
      `UPDATE users SET role = COALESCE($3, role), status = COALESCE($4, status), password_hash = COALESCE($5, password_hash)
       WHERE id = $1 AND org_id = $2 RETURNING id, org_id, name, email, role, status, created_at`,
      [id, p.orgId, b.role ?? null, b.status ?? null, b.password ? await hashPassword(b.password) : null],
    );
    if (!rows[0]) throw notFound("Usuário");
    if (b.status === "disabled" || b.password || b.role) {
      await ctx.db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
    }
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "user.update", targetType: "user", targetId: id, data: { role: b.role, status: b.status, passwordReset: !!b.password } });
    return toUserDTO(rows[0]);
  });

  /** US-012 — auditoria de downloads/publicações. */
  app.get("/v1/admin/audit", async (req) => {
    const p = requirePermission(ctx, req, "audit:read");
    const q = parse(z.object({ action: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().optional() }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT l.id, l.action, l.target_type, l.target_id, l.data, l.at, u.name AS actor_name
       FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
       WHERE l.org_id = $1 AND ($2::text IS NULL OR l.action LIKE $2 || '%') AND ($3::bigint IS NULL OR l.id < $3)
       ORDER BY l.id DESC LIMIT $4`,
      [p.orgId, q.action ?? null, q.before ?? null, q.limit],
    );
    return rows.map((r) => ({ id: Number(r.id), action: r.action, targetType: r.target_type, targetId: r.target_id, data: r.data, at: r.at.toISOString(), actor: r.actor_name }));
  });

  app.get("/v1/admin/devices", async (req) => {
    const p = requirePermission(ctx, req, "diagnostics:read");
    const { rows } = await ctx.db.query(
      `SELECT d.id, d.name, d.os, d.app_version, d.host_versions, d.last_seen, d.revoked_at, u.name AS user_name,
         COALESCE(json_agg(json_build_object('pack', i.pack_slug, 'version', i.installed_version, 'status', i.status)) FILTER (WHERE i.pack_slug IS NOT NULL), '[]') AS installs
       FROM devices d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN installs i ON i.device_id = d.id
       WHERE d.org_id = $1 GROUP BY d.id, u.name ORDER BY d.last_seen DESC`,
      [p.orgId],
    );
    return rows;
  });

  app.post("/v1/admin/devices/:id/revoke", async (req) => {
    const p = requirePermission(ctx, req, "user:manage");
    const { id } = parse(idParams, req.params);
    const r = await ctx.db.query("UPDATE devices SET revoked_at = now() WHERE id = $1 AND org_id = $2", [id, p.orgId]);
    if (!r.rowCount) throw notFound("Dispositivo");
    await audit(ctx.db, { orgId: p.orgId, actorId: p.userId, action: "device.revoke", targetType: "device", targetId: id });
    return { status: "revoked" };
  });
}
