/** Cliente HTTP do Gerenciador (Node/Electron). O refresh token é guardado pelo chamador (safeStorage). */
import type { ApiErrorBody, SessionDTO, UserDTO } from "@motionhub/shared";

export class OfflineError extends Error {
  constructor() {
    super("Sem conexão com o servidor.");
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface StoredSession {
  baseUrl: string;
  refreshToken: string;
  user: UserDTO;
}

export class DesktopApi {
  private access: string | null = null;

  constructor(
    public session: StoredSession | null,
    private readonly persist: (s: StoredSession | null) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async login(baseUrl: string, email: string, password: string): Promise<UserDTO> {
    const base = baseUrl.replace(/\/+$/, "");
    const s = await this.raw<SessionDTO>(base, "POST", "/v1/auth/session", { email, password });
    await this.store(base, s);
    return s.user;
  }

  async logout(): Promise<void> {
    if (this.session) await this.raw(this.session.baseUrl, "DELETE", "/v1/auth/session", { refreshToken: this.session.refreshToken }).catch(() => {});
    this.session = null;
    this.access = null;
    await this.persist(null);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.session) throw new ApiError(401, "unauthorized", "Faça login.");
    if (!this.access) await this.refresh();
    try {
      return await this.raw<T>(this.session.baseUrl, method, path, body, this.access!);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await this.refresh();
        return this.raw<T>(this.session!.baseUrl, method, path, body, this.access!);
      }
      throw e;
    }
  }

  /** Requisição de arquivo (URL assinada), opcionalmente a partir de um byte (retomada). */
  async fetchFile(url: string, fromByte = 0, signal?: AbortSignal): Promise<Response> {
    try {
      return await this.fetchImpl(url, { headers: fromByte ? { Range: `bytes=${fromByte}-` } : {}, signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new OfflineError();
    }
  }

  private async refresh(): Promise<void> {
    const s = this.session!;
    try {
      const r = await this.raw<SessionDTO>(s.baseUrl, "POST", "/v1/auth/session", { refreshToken: s.refreshToken });
      await this.store(s.baseUrl, r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.session = null;
        await this.persist(null);
      }
      throw e;
    }
  }

  private async store(baseUrl: string, s: SessionDTO): Promise<void> {
    this.access = s.accessToken;
    this.session = { baseUrl, refreshToken: s.refreshToken, user: s.user };
    await this.persist(this.session);
  }

  private async raw<T>(base: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new OfflineError();
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const e = (json as ApiErrorBody | null)?.error;
      throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Erro ${res.status}`);
    }
    return json as T;
  }
}
