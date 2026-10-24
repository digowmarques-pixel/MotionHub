/** Formatos locais do Gerenciador (biblioteca instalada) e contratos com a API. */

export interface PackSummary {
  id: string;
  slug: string;
  name: string;
  version: string;
  license: string;
  status: string;
  archiveSha256: string | null;
  archiveBytes: number | null;
  createdAt: string;
  assetCount?: number;
  types?: string[];
  hosts?: string[];
  posterUrl?: string | null;
}

/** manifest.json dentro do .mlpack (assinado pelo servidor). */
export interface MlpackManifest {
  format: "mlpack/1";
  slug: string;
  name: string;
  version: string;
  license: string;
  createdAt: string;
  hosts: Array<{ name: string; minVersion: string }>;
  assets: Array<{
    assetId: string;
    slug: string;
    version: string;
    manifest: { type: string; name: string; [k: string]: unknown };
    files: Array<{ path: string; sha256: string; bytes: number; role: string }>;
  }>;
}

export interface InstalledFile {
  path: string;
  role: string;
  sha256: string;
  absPath: string;
}

export interface InstalledPackVersion {
  packId: string;
  version: string;
  name: string;
  installedAt: string;
  dir: string;
  assets: Array<{ assetId: string; slug: string; version: string; type: string; name: string; files: InstalledFile[] }>;
}

export interface InstalledPack {
  slug: string;
  current: string;
  /** Versão anterior estável, para rollback (§7.3). */
  previous: string | null;
  versions: Record<string, InstalledPackVersion>;
  revoked?: boolean;
}

/** index.json da biblioteca — também lido pelo plugin do Premiere. */
export interface LibraryIndex {
  schema: 1;
  updatedAt: string;
  packs: Record<string, InstalledPack>;
}

export type InstallStage = "manifest" | "download" | "verify" | "extract" | "activate" | "done";

export interface InstallProgress {
  slug: string;
  stage: InstallStage;
  done: number;
  total: number;
}

export class InstallError extends Error {
  constructor(
    readonly code: "signature_invalid" | "hash_mismatch" | "unsafe_archive" | "download_failed" | "disk_full" | "revoked" | "cancelled" | "untrusted_key",
    message: string,
  ) {
    super(message);
    this.name = "InstallError";
  }
}
