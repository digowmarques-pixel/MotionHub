import type { FastifyRequest } from "fastify";
import { can, type Permission, type Role } from "@motionhub/shared";
import { verifyJwt } from "./crypto.js";
import { forbidden, unauthorized } from "./errors.js";
import type { AppContext } from "./context.js";

export interface Principal {
  userId: string;
  orgId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export function authenticate(ctx: AppContext, req: FastifyRequest): Principal {
  if (req.principal) return req.principal;
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) throw unauthorized();
  const claims = verifyJwt(h.slice(7), ctx.config.jwtSecret);
  if (!claims) throw unauthorized("Token inválido ou expirado.");
  req.principal = { userId: claims.sub, orgId: claims.org, role: claims.role as Role };
  return req.principal;
}

export function requirePermission(ctx: AppContext, req: FastifyRequest, permission: Permission): Principal {
  const p = authenticate(ctx, req);
  if (!can(p.role, permission)) throw forbidden();
  return p;
}
