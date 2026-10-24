import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { authenticate } from "../auth.js";
import { forbidden } from "../errors.js";
import { parse } from "../util.js";

const heartbeat = z.object({
  deviceId: z.uuid().optional(),
  name: z.string().min(1).max(120),
  os: z.string().min(1).max(60),
  appVersion: z.string().max(40).optional(),
  hostVersions: z.record(z.string().max(40), z.string().max(40)).default({}),
  installs: z
    .array(z.object({ packSlug: z.string().max(80), version: z.string().max(40), status: z.enum(["installed", "failed", "pending"]) }))
    .max(500)
    .default([]),
});

/** Remove caminhos pessoais (usuário do SO) de textos de diagnóstico (M15). */
export function maskPersonalPaths(s: string): string {
  return s
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/g, "$1<user>")
    .replace(/(\/Users\/)[^/\s"']+/g, "$1<user>")
    .replace(/(\/home\/)[^/\s"']+/g, "$1<user>");
}

function maskDeep(v: unknown): unknown {
  if (typeof v === "string") return maskPersonalPaths(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}

export function deviceRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** POST /v1/devices/heartbeat — estado de versão do cliente; responde com pacotes revogados. */
  app.post("/v1/devices/heartbeat", async (req) => {
    const p = authenticate(ctx, req);
    const b = parse(heartbeat, req.body);
    let deviceId = b.deviceId;
    if (deviceId) {
      const r = await ctx.db.query<{ revoked_at: Date | null }>(
        `UPDATE devices SET name=$3, os=$4, app_version=$5, host_versions=$6, user_id=$7, last_seen=now() WHERE id=$1 AND org_id=$2 RETURNING revoked_at`,
        [deviceId, p.orgId, b.name, b.os, b.appVersion ?? null, JSON.stringify(b.hostVersions), p.userId],
      );
      if (r.rows[0]?.revoked_at) throw forbidden("Dispositivo revogado pelo administrador.");
      if (!r.rowCount) deviceId = undefined;
    }
    if (!deviceId) {
      deviceId = (
        await ctx.db.query<{ id: string }>(
          `INSERT INTO devices (org_id, user_id, name, os, app_version, host_versions) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [p.orgId, p.userId, b.name, b.os, b.appVersion ?? null, JSON.stringify(b.hostVersions)],
        )
      ).rows[0]!.id;
    }
    for (const i of b.installs) {
      await ctx.db.query(
        `INSERT INTO installs (device_id, pack_slug, installed_version, status) VALUES ($1,$2,$3,$4)
         ON CONFLICT (device_id, pack_slug) DO UPDATE SET installed_version = EXCLUDED.installed_version, status = EXCLUDED.status, last_check = now()`,
        [deviceId, i.packSlug, i.version, i.status],
      );
    }
    const revoked = (
      await ctx.db.query<{ slug: string; version: string }>("SELECT slug, version FROM packs WHERE org_id = $1 AND status = 'revoked'", [p.orgId])
    ).rows;
    return { deviceId, serverTime: new Date().toISOString(), revokedPacks: revoked };
  });

  /** POST /v1/diagnostics — somente com consentimento explícito; caminhos pessoais mascarados. */
  app.post("/v1/diagnostics", { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const p = authenticate(ctx, req);
    const b = parse(z.object({ consent: z.literal(true), deviceId: z.uuid().optional(), payload: z.record(z.string(), z.unknown()) }), req.body);
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO diagnostics (org_id, user_id, device_id, payload)
       VALUES ($1, $2, (SELECT id FROM devices WHERE id = $3 AND org_id = $1), $4) RETURNING id`,
      [p.orgId, p.userId, b.deviceId ?? null, JSON.stringify(maskDeep(b.payload))],
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });
}
