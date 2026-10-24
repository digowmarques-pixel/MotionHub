import type { ApiErrorBody, SessionDTO, UserDTO } from "@motionhub/shared";
import type { Platform } from "../platform/types.js";

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
    readonly correlationId?: string,
  ) {
    super(message);
  }
}

const SECURE_KEY = "motionhub.session";

interface StoredSession {
  baseUrl: string;
  refreshToken: string;
  user: UserDTO;
}

/** Cliente HTTP com renovação automática do token; o refresh token fica no secureStorage. */
export class ApiClient {
  private accessToken: string | null = null;
  private session: StoredSession | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly platform: Platform) {}

  get user(): UserDTO | null {
    return this.session?.user ?? null;
  }
  get baseUrl(): string | null {
    return this.session?.baseUrl ?? null;
  }

  /** Recupera sessão salva (funciona offline: usuário fica conhecido até o próximo acesso à rede). */
  async restore(): Promise<boolean> {
    const raw = await this.platform.secureGet(SECURE_KEY);
    if (!raw) return false;
    try {
      this.session = JSON.parse(raw) as StoredSession;
      return true;
    } catch {
      return false;
    }
  }

  async login(baseUrl: string, email: string, password: string): Promise<UserDTO> {
    const url = baseUrl.replace(/\/+$/, "");
    const s = await this.raw<SessionDTO>(url, "POST", "/v1/auth/session", { email, password });
    await this.saveSession(url, s);
    return s.user;
  }

  async logout(): Promise<void> {
    if (this.session) {
      await this.raw(this.session.baseUrl, "DELETE", "/v1/auth/session", { refreshToken: this.session.refreshToken }).catch(() => {});
    }
    this.session = null;
    this.accessToken = null;
    await this.platform.secureSet(SECURE_KEY, null);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.session) throw new ApiError(401, "unauthorized", "Faça login.");
    if (!this.accessToken) await this.refresh();
    try {
      return await this.raw<T>(this.session.baseUrl, method, path, body, this.accessToken!);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await this.refresh();
        return this.raw<T>(this.session.baseUrl, method, path, body, this.accessToken!);
      }
      throw e;
    }
  }

  /** Download binário de URL assinada (sem token). */
  async download(url: string): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await this.platform.fetch(url);
    } catch {
      throw new OfflineError();
    }
    if (!res.ok) throw new ApiError(res.status, "download_failed", `Falha no download (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const s = this.session!;
        const r = await this.raw<SessionDTO>(s.baseUrl, "POST", "/v1/auth/session", { refreshToken: s.refreshToken });
        await this.saveSession(s.baseUrl, r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          this.session = null;
          await this.platform.secureSet(SECURE_KEY, null);
        }
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async saveSession(baseUrl: string, s: SessionDTO): Promise<void> {
    this.accessToken = s.accessToken;
    this.session = { baseUrl, refreshToken: s.refreshToken, user: s.user };
    await this.platform.secureSet(SECURE_KEY, JSON.stringify(this.session));
  }

  private async raw<T>(baseUrl: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await this.platform.fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new OfflineError();
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (json as ApiErrorBody | null)?.error;
      throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Erro ${res.status}`, err?.correlationId);
    }
    return json as T;
  }
}
