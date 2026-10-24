import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Role, SessionDTO, UserDTO } from "@motionhub/shared";
import type { AppContext } from "../context.js";
import { audit } from "../context.js";
import { hashPassword, randomToken, sha256Hex, signJwt, verifyPassword } from "../crypto.js";
import { unauthorized } from "../errors.js";
import { authenticate } from "../auth.js";
import { parse } from "../util.js";
import type { Queryable } from "../db.js";
import { withTx } from "../db.js";

interface UserRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  password_hash: string;
  created_at: Date;
}

export const toUserDTO = (u: Omit<UserRow, "password_hash">): UserDTO => ({
  id: u.id,
  orgId: u.org_id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  createdAt: u.created_at.toISOString(),
});

const sessionBody = z.union([
  z.object({ email: z.email(), password: z.string().min(1).max(200) }),
  z.object({ refreshToken: z.string().min(20).max(200) }),
]);

// Hash fixo para igualar o tempo de resposta quando o e-mail não existe.
let dummyHash: Promise<string> | null = null;

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const issue = async (q: Queryable, user: UserRow, family: string): Promise<SessionDTO> => {
    const refreshToken = randomToken();
    await q.query(
      `INSERT INTO refresh_tokens (user_id, family, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`,
      [user.id, family, sha256Hex(refreshToken), ctx.config.refreshTtlSec],
    );
    return {
      accessToken: signJwt({ sub: user.id, org: user.org_id, role: user.role }, ctx.config.jwtSecret, ctx.config.accessTtlSec),
      refreshToken,
      expiresIn: ctx.config.accessTtlSec,
      user: toUserDTO(user),
    };
  };

  /** POST /v1/auth/session — login com senha ou renovação via refresh token (rotacionado a cada uso). */
  app.post("/v1/auth/session", { config: { rateLimit: "auth" } }, async (req) => {
    const body = parse(sessionBody, req.body);

    if ("email" in body) {
      const { rows } = await ctx.db.query<UserRow>("SELECT * FROM users WHERE lower(email) = lower($1)", [body.email]);
      const user = rows[0];
      dummyHash ??= hashPassword(randomToken());
      const ok = await verifyPassword(body.password, user?.password_hash ?? (await dummyHash));
      if (!user || !ok || user.status !== "active") throw unauthorized("E-mail ou senha incorretos.");
      const session = await issue(ctx.db, user, randomUUID());
      await audit(ctx.db, { orgId: user.org_id, actorId: user.id, action: "auth.login", targetType: "user", targetId: user.id });
      return session;
    }

    // A revogação por reuso precisa ser confirmada (COMMIT) antes de responder 401.
    const outcome = await withTx(ctx.db, async (tx): Promise<SessionDTO | "reused"> => {
      const { rows } = await tx.query<{ id: string; user_id: string; family: string; used_at: Date | null; revoked_at: Date | null; expired: boolean }>(
        `SELECT id, user_id, family, used_at, revoked_at, expires_at < now() AS expired FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [sha256Hex(body.refreshToken)],
      );
      const rt = rows[0];
      if (!rt) throw unauthorized("Sessão inválida.");
      if (rt.used_at || rt.revoked_at) {
        // Reuso de refresh token: possível roubo. Revoga toda a família.
        await tx.query("UPDATE refresh_tokens SET revoked_at = now() WHERE family = $1 AND revoked_at IS NULL", [rt.family]);
        return "reused";
      }
      if (rt.expired) throw unauthorized("Sessão expirada. Faça login novamente.");
      const user = (await tx.query<UserRow>("SELECT * FROM users WHERE id = $1", [rt.user_id])).rows[0];
      if (!user || user.status !== "active") throw unauthorized("Usuário desativado.");
      await tx.query("UPDATE refresh_tokens SET used_at = now() WHERE id = $1", [rt.id]);
      return issue(tx, user, rt.family);
    });
    if (outcome === "reused") throw unauthorized("Sessão revogada. Faça login novamente.");
    return outcome;
  });

  /** DELETE /v1/auth/session — logout: revoga a família do refresh token. */
  app.delete("/v1/auth/session", async (req, reply) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    await ctx.db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND family = (SELECT family FROM refresh_tokens WHERE token_hash = $1)`,
      [sha256Hex(refreshToken)],
    );
    return reply.status(204).send();
  });

  app.get("/v1/me", async (req) => {
    const p = authenticate(ctx, req);
    const { rows } = await ctx.db.query<UserRow>("SELECT * FROM users WHERE id = $1", [p.userId]);
    if (!rows[0]) throw unauthorized();
    return toUserDTO(rows[0]);
  });
}
