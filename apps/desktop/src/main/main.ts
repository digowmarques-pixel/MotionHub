/**
 * Processo principal do Gerenciador desktop (M11).
 * Janela isolada (contextIsolation + sandbox); toda operação de disco/rede acontece aqui.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arch, release } from "node:os";
import { DesktopApi, OfflineError, ApiError, type StoredSession } from "../core/api.js";
import { Library } from "../core/library.js";
import { installPack, type TrustedKey } from "../core/installer.js";
import { detectHosts, type HostInstall } from "../core/hosts.js";
import { Logger, maskPaths } from "../core/logger.js";
import type { ListResult, PackRow, Settings } from "../core/bridge.js";
import type { PackSummary } from "../core/types.js";

interface StoredSettings {
  libraryDir?: string;
  trustedKey?: TrustedKey;
  deviceId?: string;
}

const userData = () => app.getPath("userData");
const settingsFile = () => join(userData(), "settings.json");
const sessionFile = () => join(userData(), "session.bin");

let win: BrowserWindow | null = null;
let settings: StoredSettings = {};
let library: Library;
let api: DesktopApi;
let hosts: HostInstall[] = [];
let lastPacks: PackSummary[] = [];
let revokedRemote: Array<{ slug: string; version: string }> = [];
const logger = new Logger(join(app.getPath("logs"), "manager.log"));
const running = new Map<string, AbortController>();
const MAX_CONCURRENT = 2;

async function loadSettings(): Promise<void> {
  try {
    settings = JSON.parse(await readFile(settingsFile(), "utf8")) as StoredSettings;
  } catch {
    settings = {};
  }
}
const saveSettings = () => writeFile(settingsFile(), JSON.stringify(settings, null, 2));

/** Sessão cifrada pelo cofre do sistema (Keychain/DPAPI). Sem cofre disponível, não persiste. */
async function loadSession(): Promise<StoredSession | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return JSON.parse(safeStorage.decryptString(await readFile(sessionFile()))) as StoredSession;
  } catch {
    return null;
  }
}
async function persistSession(s: StoredSession | null): Promise<void> {
  if (!s) return writeFile(sessionFile(), "").catch(() => {});
  if (!safeStorage.isEncryptionAvailable()) return;
  await writeFile(sessionFile(), safeStorage.encryptString(JSON.stringify(s)));
}

const notifyChanged = () => win?.webContents.send("mh:changed");

/** Confia na chave de assinatura no primeiro login (TOFU) e recusa troca silenciosa depois. */
async function ensureTrustedKey(): Promise<TrustedKey> {
  const embedded = process.env.MOTIONHUB_PACK_PUBLIC_KEY;
  if (embedded) return { keyId: process.env.MOTIONHUB_PACK_KEY_ID ?? "embedded", publicKeyPem: embedded };
  const remote = await api.request<{ keyId: string; publicKeyPem: string }>("GET", "/v1/packs/signing-key");
  if (!settings.trustedKey) {
    settings.trustedKey = { keyId: remote.keyId, publicKeyPem: remote.publicKeyPem };
    await saveSettings();
    await logger.log("info", "chave de assinatura registrada", { keyId: remote.keyId });
  } else if (settings.trustedKey.keyId !== remote.keyId) {
    await logger.log("warn", "servidor apresentou chave diferente da confiável", { trusted: settings.trustedKey.keyId, remote: remote.keyId });
  }
  return settings.trustedKey;
}

async function heartbeat(): Promise<void> {
  if (!api.session) return;
  try {
    const idx = library.snapshot;
    const r = await api.request<{ deviceId: string; revokedPacks: Array<{ slug: string; version: string }> }>("POST", "/v1/devices/heartbeat", {
      deviceId: settings.deviceId,
      name: `${process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "PC" : "Estação"} ${api.session.user.name}`.slice(0, 120),
      os: `${process.platform} ${release()} ${arch()}`,
      appVersion: app.getVersion(),
      hostVersions: Object.fromEntries(hosts.map((h) => [h.host, h.version])),
      installs: Object.values(idx.packs).map((p) => ({ packSlug: p.slug, version: p.current, status: "installed" })),
    });
    if (r.deviceId !== settings.deviceId) {
      settings.deviceId = r.deviceId;
      await saveSettings();
    }
    const hit = await library.markRevoked(r.revokedPacks);
    if (hit.length) {
      await logger.log("warn", "pacotes revogados pelo administrador", { packs: hit });
      notifyChanged();
    }
  } catch (e) {
    await logger.log("warn", "heartbeat falhou", { error: (e as Error).message });
  }
}

async function list(): Promise<ListResult> {
  let online = true;
  let error: string | null = null;
  try {
    const r = await api.request<{ packs: PackSummary[]; revoked: Array<{ slug: string; version: string }> }>("GET", "/v1/packs");
    lastPacks = r.packs;
    revokedRemote = r.revoked;
    await library.markRevoked(r.revoked);
  } catch (e) {
    online = !(e instanceof OfflineError);
    error = (e as Error).message;
  }
  const idx = library.snapshot;
  const rows: PackRow[] = lastPacks.map((p) => {
    const inst = idx.packs[p.slug];
    return {
      ...p,
      installedVersion: inst?.current ?? null,
      previousVersion: inst?.previous ?? null,
      revoked: !!inst?.revoked || revokedRemote.some((r) => r.slug === p.slug && r.version === inst?.current),
      orphan: false,
    };
  });
  // Pacotes instalados que o servidor não lista mais (ou lista offline): continuam visíveis.
  for (const inst of Object.values(idx.packs)) {
    if (rows.some((r) => r.slug === inst.slug)) continue;
    const v = inst.versions[inst.current]!;
    rows.push({
      id: v.packId, slug: inst.slug, name: v.name, version: inst.current, license: "", status: inst.revoked ? "revoked" : "ready",
      archiveSha256: null, archiveBytes: null, createdAt: v.installedAt, assetCount: v.assets.length,
      types: [...new Set(v.assets.map((a) => a.type))], hosts: [], posterUrl: null,
      installedVersion: inst.current, previousVersion: inst.previous, revoked: !!inst.revoked, orphan: online,
    });
  }
  return { online, error, packs: rows };
}

async function install(packId: string): Promise<void> {
  const pack = lastPacks.find((p) => p.id === packId);
  if (!pack) throw new Error("Pacote não encontrado. Atualize a lista.");
  if (running.has(pack.slug)) return;
  while (running.size >= MAX_CONCURRENT) await new Promise((r) => setTimeout(r, 300));
  const ctrl = new AbortController();
  running.set(pack.slug, ctrl);
  try {
    const key = await ensureTrustedKey();
    await logger.log("info", "instalando pacote", { slug: pack.slug, version: pack.version });
    await installPack(api, library, pack, key, { signal: ctrl.signal, onProgress: (p) => win?.webContents.send("mh:progress", p) });
    await logger.log("info", "pacote instalado", { slug: pack.slug, version: pack.version });
    void heartbeat();
  } catch (e) {
    const msg = (e as Error).message;
    await logger.log("error", "falha ao instalar", { slug: pack.slug, version: pack.version, code: (e as { code?: string }).code, error: msg });
    win?.webContents.send("mh:progress", { slug: pack.slug, stage: "done", done: 0, total: 1, error: msg });
    throw e;
  } finally {
    running.delete(pack.slug);
    notifyChanged();
  }
}

async function currentSettings(): Promise<Settings> {
  return { libraryDir: library.root, trustedKeyId: settings.trustedKey?.keyId ?? null, appVersion: app.getVersion(), hosts, deviceId: settings.deviceId ?? null };
}

function registerIpc(): void {
  const handle = <A extends unknown[], R>(ch: string, fn: (...a: A) => Promise<R>) =>
    ipcMain.handle(ch, async (event, ...args) => {
      // Só aceita chamadas da nossa própria janela.
      if (event.sender !== win?.webContents) throw new Error("origem não autorizada");
      try {
        return await fn(...(args as A));
      } catch (e) {
        const err = e instanceof ApiError || e instanceof OfflineError ? e.message : (e as Error).message;
        throw new Error(err);
      }
    });

  handle("mh:session", async () => ({ user: api.session?.user ?? null, server: api.session?.baseUrl ?? null }));
  handle("mh:login", async (server: string, email: string, password: string) => {
    if (typeof server !== "string" || !/^https?:\/\//.test(server)) throw new Error("Endereço do servidor inválido.");
    const u = await api.login(server, String(email), String(password));
    await ensureTrustedKey().catch(() => {});
    void heartbeat();
    return u;
  });
  handle("mh:logout", async () => api.logout());
  handle("mh:list", list);
  handle("mh:install", async (id: string) => install(String(id)));
  handle("mh:installAll", async () => {
    const todo = lastPacks.filter((p) => p.status === "ready" && library.installed(p.slug) !== p.version);
    const results = await Promise.allSettled(todo.map((p) => install(p.id)));
    return { installed: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
  });
  handle("mh:cancel", async (slug: string) => running.get(String(slug))?.abort());
  handle("mh:uninstall", async (slug: string) => {
    await library.uninstall(String(slug));
    await logger.log("info", "pacote removido do índice", { slug });
    void heartbeat();
    notifyChanged();
  });
  handle("mh:rollback", async (slug: string) => {
    const v = await library.rollback(String(slug));
    await logger.log("info", "rollback de pacote", { slug, to: v });
    void heartbeat();
    notifyChanged();
    return v;
  });
  handle("mh:settings", currentSettings);
  handle("mh:chooseLibraryDir", async () => {
    const r = await dialog.showOpenDialog(win!, { title: "Escolha a pasta da biblioteca", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const target = join(r.filePaths[0], "Megalume Motion Hub");
    const ok = await dialog.showMessageBox(win!, {
      type: "warning",
      buttons: ["Copiar e usar a nova pasta", "Cancelar"],
      defaultId: 0,
      cancelId: 1,
      message: "Mudar a pasta da biblioteca",
      detail: "Os pacotes serão COPIADOS para a nova pasta. A pasta antiga é mantida: projetos abertos com os arquivos antigos continuam funcionando. Você pode apagá-la depois de reconectar a mídia.",
    });
    if (ok.response !== 0) return null;
    await mkdir(target, { recursive: true });
    await cp(library.root, target, { recursive: true, force: false, errorOnExist: false, filter: (src) => !src.includes(".staging") });
    // Atualiza caminhos absolutos no índice copiado.
    const idxFile = join(target, "index.json");
    const raw = await readFile(idxFile, "utf8").catch(() => null);
    if (raw) await writeFile(idxFile, raw.split(JSON.stringify(library.root).slice(1, -1)).join(JSON.stringify(target).slice(1, -1)));
    settings.libraryDir = target;
    await saveSettings();
    library = new Library(target);
    await library.load();
    await logger.log("info", "pasta da biblioteca alterada");
    notifyChanged();
    return currentSettings();
  });
  handle("mh:purge", async () => library.purgeOldVersions());
  handle("mh:openLibrary", async () => void (await shell.openPath(library.root)));
  handle("mh:library", async () => library.snapshot);
  const diagnostics = async () => ({
    app: app.getVersion(),
    os: `${process.platform} ${release()} ${arch()}`,
    hosts,
    library: Object.values(library.snapshot.packs).map((p) => ({ slug: p.slug, current: p.current, previous: p.previous, revoked: !!p.revoked })),
    log: (await logger.tail(300)).map(maskPaths),
  });
  handle("mh:exportDiagnostics", async () => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: `motionhub-diagnostico-${new Date().toISOString().slice(0, 10)}.json` });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, JSON.stringify(await diagnostics(), null, 2));
    return r.filePath;
  });
  handle("mh:sendDiagnostics", async (consent: boolean) => {
    if (consent !== true) throw new Error("É preciso consentir com o envio.");
    const r = await api.request<{ id: string }>("POST", "/v1/diagnostics", { consent: true, deviceId: settings.deviceId, payload: await diagnostics() });
    return r.id;
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#1f1f1f",
    title: "Megalume Motion Hub",
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  // Nada de navegação para fora do app nem janelas novas.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void win.loadFile(join(__dirname, "index.html"));
  win.on("closed", () => (win = null));
}

// Permite isolar dados em testes/instalações paralelas.
if (process.env.MOTIONHUB_USER_DATA) app.setPath("userData", process.env.MOTIONHUB_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  void app.whenReady().then(async () => {
    await mkdir(userData(), { recursive: true });
    await loadSettings();
    const libDir = settings.libraryDir ?? process.env.MOTIONHUB_LIBRARY_DIR ?? join(app.getPath("userData"), "Library");
    library = new Library(libDir);
    await library.load();
    api = new DesktopApi(await loadSession(), persistSession);
    hosts = await detectHosts().catch(() => []);
    registerIpc();
    createWindow();
    await logger.log("info", "gerenciador iniciado", { version: app.getVersion(), hosts: hosts.map((h) => `${h.host} ${h.version}`) });
    void heartbeat();
    setInterval(() => void heartbeat(), 15 * 60 * 1000);
  });
  app.on("window-all-closed", () => {
    for (const c of running.values()) c.abort();
    app.quit();
  });
}

