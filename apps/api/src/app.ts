import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import type { ApiErrorBody } from "@motionhub/shared";
import type { AppContext } from "./context.js";
import { HttpError } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { assetRoutes } from "./routes/assets.js";
import { adminAssetRoutes } from "./routes/admin-assets.js";
import { packRoutes } from "./routes/packs.js";
import { deviceRoutes } from "./routes/devices.js";
import { adminUserRoutes } from "./routes/admin-users.js";

declare module "fastify" {
  interface FastifyContextConfig {
    rateLimit?: "auth";
  }
}

/** Limitador simples em memória para login (por IP). Em cluster, trocar por Redis. */
function authLimiter(max = 10, windowMs = 60_000) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) {
      hits.set(ip, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    return ++h.n <= max;
  };
}

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    genReqId: (req) => {
      const h = req.headers["x-correlation-id"];
      return typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: ctx.config.corsOrigins.length ? ctx.config.corsOrigins : false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: ["X-Correlation-Id", "ETag"],
  });

  const limiter = authLimiter(ctx.config.authRateLimitPerMin);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Correlation-Id", req.id);
    if (req.routeOptions.config.rateLimit === "auth" && !limiter(req.ip)) {
      const body: ApiErrorBody = { error: { code: "rate_limited", message: "Muitas tentativas. Aguarde um minuto.", correlationId: req.id } };
      return reply.status(429).send(body);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    let status = 500;
    let body: ApiErrorBody;
    if (err instanceof HttpError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, details: err.details, correlationId: req.id } };
    } else if (err.statusCode && err.statusCode < 500) {
      status = err.statusCode;
      const code = err.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? "payload_too_large" : "bad_request";
      body = { error: { code, message: err.message, correlationId: req.id } };
    } else {
      req.log.error(err);
      body = { error: { code: "internal", message: "Erro interno. Informe o código de correlação ao suporte.", correlationId: req.id } };
    }
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiErrorBody = { error: { code: "not_found", message: "Rota não encontrada.", correlationId: req.id } };
    return reply.status(404).send(body);
  });

  app.get("/health", async () => {
    await ctx.db.query("SELECT 1");
    return { status: "ok" };
  });

  authRoutes(app, ctx);
  assetRoutes(app, ctx);
  adminAssetRoutes(app, ctx);
  packRoutes(app, ctx);
  deviceRoutes(app, ctx);
  adminUserRoutes(app, ctx);
  return app;
}
