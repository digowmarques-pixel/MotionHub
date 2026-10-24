import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "./api";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    return `${e.message} ${(e.details as Array<{ path: string; message: string }>).map((d) => `${d.path}: ${d.message}`).join("; ")}`;
  }
  if (e instanceof ApiError && e.details && typeof e.details === "object" && "missing" in (e.details as object)) {
    return `${e.message} Faltando: ${(e.details as { missing: string[] }).missing.join(", ")}`;
  }
  return (e as Error).message;
}

export const STATE_LABEL: Record<string, string> = {
  draft: "Rascunho",
  review: "Em revisão",
  published: "Publicado",
  deprecated: "Descontinuado",
  validated: "Em revisão",
  withdrawn: "Retirado",
  queued: "Na fila",
  running: "Processando",
  succeeded: "Concluído",
  failed: "Falhou",
  building: "Gerando",
  ready: "Pronto",
  revoked: "Revogado",
};

export function Badge({ state }: { state: string }) {
  return <span className={`badge s-${state}`}>{STATE_LABEL[state] ?? state}</span>;
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
