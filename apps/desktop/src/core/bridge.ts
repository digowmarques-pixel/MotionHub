/** Contrato IPC entre a janela (renderer) e o processo principal. */
import type { UserDTO } from "@motionhub/shared";
import type { InstallProgress, LibraryIndex, PackSummary } from "./types.js";
import type { HostInstall } from "./hosts.js";

export interface PackRow extends PackSummary {
  installedVersion: string | null;
  previousVersion: string | null;
  revoked: boolean;
  /** Instalado localmente mas não oferecido mais pelo servidor. */
  orphan: boolean;
}

export interface Settings {
  libraryDir: string;
  trustedKeyId: string | null;
  appVersion: string;
  hosts: HostInstall[];
  deviceId: string | null;
}

export interface ListResult {
  online: boolean;
  error: string | null;
  packs: PackRow[];
}

export interface MotionHubBridge {
  session(): Promise<{ user: UserDTO | null; server: string | null }>;
  login(server: string, email: string, password: string): Promise<UserDTO>;
  logout(): Promise<void>;
  list(): Promise<ListResult>;
  install(packId: string): Promise<void>;
  installAll(): Promise<{ installed: number; failed: number }>;
  cancel(slug: string): Promise<void>;
  uninstall(slug: string): Promise<void>;
  rollback(slug: string): Promise<string>;
  settings(): Promise<Settings>;
  chooseLibraryDir(): Promise<Settings | null>;
  purgeOldVersions(): Promise<number>;
  openLibraryFolder(): Promise<void>;
  exportDiagnostics(): Promise<string | null>;
  sendDiagnostics(consent: true): Promise<string>;
  library(): Promise<LibraryIndex>;
  onProgress(cb: (p: InstallProgress & { error?: string }) => void): () => void;
  onChanged(cb: () => void): () => void;
}
