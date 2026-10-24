/** Contratos de dados da API HTTP v1 (Especificação §6, §6.2). */
import type { AspectRatio, AssetState, AssetType, FileRole, HostName } from "./asset.js";
import type { Role } from "./roles.js";
import type { HostTarget, Parameter } from "./manifest.js";

export interface UserDTO {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  createdAt: string;
}

export interface SessionDTO {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserDTO;
}

export interface AssetFileDTO {
  id: string;
  role: FileRole;
  path: string;
  mime: string;
  bytes: number;
  sha256: string;
}

export interface AssetVersionDTO {
  id: string;
  assetId: string;
  semver: string;
  hostTargets: HostTarget[];
  manifestSchema: string;
  status: "draft" | "validated" | "published" | "withdrawn";
  releaseDate: string | null;
  changelog: string | null;
  parameters: Parameter[];
  files: AssetFileDTO[];
}

export interface AssetDTO {
  id: string;
  slug: string;
  name: string;
  type: AssetType;
  summary: string | null;
  tags: string[];
  synonyms: string[];
  category: string | null;
  client: string | null;
  aspectRatio: AspectRatio;
  language: string | null;
  hosts: HostName[];
  rights: string;
  creatorId: string;
  state: AssetState;
  latestVersion: string | null;
  currentVersionId: string | null;
  posterUrl: string | null;
  previewUrl: string | null;
  durationSec: number | null;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

export interface AssetSearchQuery {
  query?: string;
  host?: HostName;
  type?: AssetType;
  tags?: string[];
  aspectRatio?: AspectRatio;
  language?: string;
  client?: string;
  state?: AssetState;
  sort?: "relevance" | "name" | "updated";
  limit?: number;
  cursor?: string;
}

export interface DownloadTicketDTO {
  url: string;
  expiresAt: string;
  sha256: string;
  bytes: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId?: string };
}
