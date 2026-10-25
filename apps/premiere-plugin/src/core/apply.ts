/**
 * Aplicar um asset (§4.1, §7.1): compatibilidade → download → validação →
 * preparar host → inserir → verificar. Cada operação tem ID de correlação.
 */
import {
  APPLY_ERROR_MESSAGES,
  ApplyError,
  ApplyOperation,
  compareHostVersion,
  validateParameterValues,
  type ApplyEvent,
  type Parameter,
  type ParameterValues,
} from "@motionhub/shared";
import type { HostAdapter, HostParamValue, InsertOptions, InsertResult } from "../host/types.js";
import type { CatalogItem } from "./catalog.js";
import type { AssetCache } from "./downloads.js";

export interface ApplyRequest {
  item: CatalogItem;
  values: ParameterValues;
  options: InsertOptions;
}

export interface ApplyDeps {
  host: HostAdapter;
  cache: AssetCache;
  hostVersion: string;
  onEvent?: (e: ApplyEvent) => void;
  onProgress?: (done: number, total: number) => void;
  newId?: () => string;
}

export interface ApplyOutcome {
  op: ApplyOperation;
  result?: InsertResult;
  message: string;
}

export function compatibility(item: CatalogItem, hostVersion: string): string | null {
  const target = item.manifest.hosts.find((h) => h.name === "premiere");
  if (!target) return "Este asset não é para Premiere Pro.";
  if (compareHostVersion(hostVersion, target.minVersion) < 0) return `Requer Premiere ${target.minVersion} ou superior.`;
  if (target.maxVersion && compareHostVersion(hostVersion, target.maxVersion) > 0) return `Compatível até Premiere ${target.maxVersion}.`;
  return null;
}

export function toHostParams(params: readonly Parameter[], values: ParameterValues): HostParamValue[] {
  return params.map((p) => ({ name: p.hostParam ?? p.label ?? p.key, type: p.type, value: values[p.key] }));
}

export async function applyAsset(req: ApplyRequest, deps: ApplyDeps): Promise<ApplyOutcome> {
  const id = deps.newId?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const op = new ApplyOperation(id, deps.onEvent);
  const { item } = req;
  const version = item.latestVersion;
  try {
    if (!version) throw new ApplyError("unsupported", "Asset sem versão publicada.");
    const incompatible = compatibility(item, deps.hostVersion);
    if (incompatible) throw new ApplyError("unsupported", incompatible);
    const values = validateParameterValues(item.manifest.parameters, req.values);
    if (!values.ok) throw new ApplyError("unsupported", `Parâmetros inválidos: ${values.issues.map((i) => `${i.path} (${i.message})`).join(", ")}`);
    op.advance("compatibility_checked");

    if (!item.local?.length && !deps.cache.isInstalled(item.id, version)) op.advance("downloading");
    const files = await deps.cache.ensure(item, version, deps.onProgress);
    op.advance("validating");

    const main = files.find((f) => f.role === "template") ?? files.find((f) => f.role === "media" || f.role === "audio");
    if (!main) throw new ApplyError("missing_dependency", "Arquivo principal ausente no pacote.");
    const ext = main.path.split(".").pop()?.toLowerCase();
    if (main.role === "template" && ext !== "mogrt") throw new ApplyError("unsupported", `Template .${ext} não é suportado no Premiere.`);

    op.advance("preparing_host");
    const ctx = await deps.host.getContext();
    if (!ctx.project) throw new ApplyError("host_no_project");
    if (!ctx.sequence) throw new ApplyError("host_no_sequence");

    op.advance("inserting");
    const result =
      main.role === "template"
        ? await deps.host.insertMogrt(main.local, req.options, toHostParams(item.manifest.parameters, values.values), item.name)
        : await deps.host.insertMedia(main.local, req.options, item.name);

    op.advance("verifying");
    if (result.trackItems < 1) throw new ApplyError("host_api_error", "Nada foi inserido na sequência.");
    op.advance("completed");
    const warn = result.warnings.length ? ` Atenção: ${result.warnings.join(" ")}` : "";
    return { op, result, message: `"${item.name}" inserido em ${ctx.sequence.name}. Use Ctrl+Z / Cmd+Z para desfazer.${warn}` };
  } catch (e) {
    const err = e instanceof ApplyError ? e : new ApplyError("host_api_error", (e as Error).message);
    op.fail(err.code, err.message);
    const base = APPLY_ERROR_MESSAGES[err.code];
    return { op, message: err.message && err.message !== base ? `${base} ${err.message}` : base };
  }
}
