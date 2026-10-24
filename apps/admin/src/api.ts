import type { ApiErrorBody, SessionDTO, UserDTO } from "@motionhub/shared";

const KEY = "motionhub.admin.session";

interface Session {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  user: UserDTO;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Sessão guardada em sessionStorage (encerra ao fechar a aba).
 * Em produção, preferir cookie httpOnly via proxy reverso — ver docs/seguranca.md.
 */
let session: Session | null = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null;
  } catch {
    return null;
  }
})();

const save = (s: Session | null) => {
  session = s;
  if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
  else sessionStorage.removeItem(KEY);
};

export const currentUser = () => session?.user ?? null;
export const baseUrl = () => session?.baseUrl ?? (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";

async function raw<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204 || res.status === 304) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Erro ${res.status}`, e?.details);
  }
  return body as T;
}

export async function login(url: string, email: string, password: string): Promise<UserDTO> {
  const base = url.replace(/\/+$/, "");
  const s = await raw<SessionDTO>(`${base}/v1/auth/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  save({ baseUrl: base, accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
  return s.user;
}

export async function logout(): Promise<void> {
  if (session) {
    await raw(`${session.baseUrl}/v1/auth/session`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: session.refreshToken }) }).catch(() => {});
  }
  save(null);
}

let refreshing: Promise<void> | null = null;
async function refresh(): Promise<void> {
  refreshing ??= (async () => {
    try {
      const s = session!;
      const r = await raw<SessionDTO>(`${s.baseUrl}/v1/auth/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: s.refreshToken }) });
      save({ ...s, accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
    } catch (e) {
      save(null);
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { raw?: Blob | ArrayBuffer } = {}): Promise<T> {
  if (!session) throw new ApiError(401, "unauthorized", "Faça login.");
  const call = () => {
    const headers: Record<string, string> = { Authorization: `Bearer ${session!.accessToken}` };
    let payload: BodyInit | undefined;
    if (opts.raw) {
      headers["Content-Type"] = "application/octet-stream";
      payload = opts.raw;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    return raw<T>(session!.baseUrl + path, { method, headers, body: payload });
  };
  try {
    return await call();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await refresh();
      return call();
    }
    throw e;
  }
}

export async function sha256File(f: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
