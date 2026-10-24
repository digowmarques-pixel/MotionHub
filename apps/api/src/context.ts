import type { Config } from "./config.js";
import type { Db, Queryable } from "./db.js";
import type { StorageDriver } from "./storage.js";
import type { PackSigner } from "./crypto.js";

export interface AppContext {
  config: Config;
  db: Db;
  storage: StorageDriver;
  signer: PackSigner | null;
}

export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  data?: Record<string, unknown>;
}

/** Log de auditoria (Especificação §9, M12, US-012). */
export async function audit(q: Queryable, e: AuditEntry): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (org_id, actor_id, action, target_type, target_id, data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [e.orgId, e.actorId, e.action, e.targetType, e.targetId ?? null, JSON.stringify(e.data ?? {})],
  );
}
