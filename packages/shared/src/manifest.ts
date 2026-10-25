/**
 * Manifest declarativo de preset (Especificação §6.1, M05, M10).
 * Formato PRÓPRIO da Megalume — não é compatível com formatos de terceiros.
 */
import { z } from "zod";
import { ASPECT_RATIOS, BLEND_MODES, ASSET_TYPES, FILE_ROLES, HOSTS } from "./asset.js";
import { isSemver } from "./semver.js";
import { isSafeRelativePath } from "./paths.js";

export const MANIFEST_SCHEMA_VERSION = "1.0";

const key = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, "chave deve começar com letra e conter apenas [a-zA-Z0-9_]");
const hexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "cor deve ser #RRGGBB ou #RRGGBBAA");
const semver = z.string().refine(isSemver, "versão deve seguir semver (ex.: 1.2.0)");
const relPath = z.string().min(1).max(260).refine(isSafeRelativePath, "caminho inválido ou inseguro");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "sha256 deve ter 64 caracteres hex minúsculos");

const base = {
  key,
  label: z.string().min(1).max(80).optional(),
  tooltip: z.string().max(240).optional(),
  group: z.string().max(40).optional(),
  /** Nome do controle no host (ex.: nome do parâmetro do MOGRT no Essential Graphics). Padrão: label, depois key. */
  hostParam: z.string().max(120).optional(),
};

export const EASINGS = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "easeOutBack",
  "easeOutBounce",
  "easeOutElastic",
] as const;
export type Easing = (typeof EASINGS)[number];

export const parameterSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("string"), default: z.string(), maxLength: z.number().int().positive().max(10000).optional() }),
  z.object({ ...base, type: z.literal("richText"), default: z.string(), maxLength: z.number().int().positive().max(10000).optional() }),
  z.object({ ...base, type: z.literal("color"), default: hexColor }),
  z.object({ ...base, type: z.literal("number"), default: z.number(), min: z.number().optional(), max: z.number().optional(), step: z.number().positive().optional() }),
  z.object({ ...base, type: z.literal("int"), default: z.number().int(), min: z.number().int().optional(), max: z.number().int().optional() }),
  z.object({ ...base, type: z.literal("enum"), default: z.string(), options: z.array(z.string()).min(1) }),
  z.object({ ...base, type: z.literal("bool"), default: z.boolean() }),
  z.object({ ...base, type: z.literal("assetRef"), default: z.string().nullable(), accept: z.array(z.string()).optional() }),
  z.object({ ...base, type: z.literal("font"), default: z.string() }),
  z.object({ ...base, type: z.literal("duration"), default: z.number().positive(), min: z.number().positive().optional(), max: z.number().positive().optional() }),
  z.object({ ...base, type: z.literal("position"), default: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]) }),
  z.object({ ...base, type: z.literal("scale"), default: z.number().positive(), min: z.number().positive().optional(), max: z.number().positive().optional() }),
  z.object({ ...base, type: z.literal("easing"), default: z.enum(EASINGS) }),
]).superRefine((p, ctx) => {
  if ("min" in p && "max" in p && p.min !== undefined && p.max !== undefined && p.min > p.max) {
    ctx.addIssue({ code: "custom", message: "min maior que max", path: ["min"] });
  }
  const d = p.default;
  if (typeof d === "number") {
    if ("min" in p && p.min !== undefined && d < p.min) ctx.addIssue({ code: "custom", message: "default abaixo de min", path: ["default"] });
    if ("max" in p && p.max !== undefined && d > p.max) ctx.addIssue({ code: "custom", message: "default acima de max", path: ["default"] });
  }
  if (p.type === "enum" && !p.options.includes(p.default)) {
    ctx.addIssue({ code: "custom", message: "default não está em options", path: ["default"] });
  }
  if ((p.type === "string" || p.type === "richText") && p.maxLength !== undefined && p.default.length > p.maxLength) {
    ctx.addIssue({ code: "custom", message: "default excede maxLength", path: ["default"] });
  }
});
export type Parameter = z.infer<typeof parameterSchema>;
export type ParameterType = Parameter["type"];
export type ParameterValues = Record<string, unknown>;

export const hostTargetSchema = z.object({
  name: z.enum(HOSTS),
  minVersion: z.string().regex(/^\d+(\.\d+){0,2}$/),
  maxVersion: z.string().regex(/^\d+(\.\d+){0,2}$/).optional(),
});
export type HostTarget = z.infer<typeof hostTargetSchema>;

export const manifestAssetSchema = z.object({
  path: relPath,
  sha256,
  role: z.enum(FILE_ROLES),
  bytes: z.number().int().nonnegative().optional(),
});

export const presetManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/, "id deve ser slug minúsculo (a-z, 0-9, -)"),
    version: semver,
    name: z.string().min(1).max(120),
    type: z.enum(ASSET_TYPES),
    summary: z.string().max(500).optional(),
    hosts: z.array(hostTargetSchema).min(1),
    assets: z.array(manifestAssetSchema).min(1),
    preview: z.object({ path: relPath, poster: relPath }),
    parameters: z.array(parameterSchema).default([]),
    aspectRatio: z.enum(ASPECT_RATIOS).default("any"),
    /** Mesclagem e opacidade (0–100) aplicadas ao clipe inserido. */
    blend: z.enum(BLEND_MODES).optional(),
    opacity: z.number().min(0).max(100).optional(),
    durationSec: z.number().positive().max(3600).optional(),
    fps: z.number().positive().max(240).optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    license: z.string().min(1),
    tags: z.array(z.string().min(1).max(40)).max(50).default([]),
    synonyms: z.array(z.string().min(1).max(40)).max(50).default([]),
    client: z.string().max(80).optional(),
    dependencies: z.array(z.object({ id: z.string(), version: z.string() })).default([]),
  })
  .superRefine((m, ctx) => {
    const keys = new Set<string>();
    m.parameters.forEach((p, i) => {
      if (keys.has(p.key)) ctx.addIssue({ code: "custom", message: `parâmetro duplicado: ${p.key}`, path: ["parameters", i, "key"] });
      keys.add(p.key);
    });
    const paths = new Set<string>();
    m.assets.forEach((a, i) => {
      if (paths.has(a.path)) ctx.addIssue({ code: "custom", message: `asset duplicado: ${a.path}`, path: ["assets", i, "path"] });
      paths.add(a.path);
    });
    const hosts = new Set<string>();
    m.hosts.forEach((h, i) => {
      if (hosts.has(h.name)) ctx.addIssue({ code: "custom", message: `host duplicado: ${h.name}`, path: ["hosts", i, "name"] });
      hosts.add(h.name);
    });
  });

export type PresetManifest = z.infer<typeof presetManifestSchema>;
export type PresetManifestInput = z.input<typeof presetManifestSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ManifestValidation =
  | { ok: true; manifest: PresetManifest }
  | { ok: false; issues: ValidationIssue[] };

export function validateManifest(input: unknown): ManifestValidation {
  const r = presetManifestSchema.safeParse(input);
  if (r.success) return { ok: true, manifest: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Valores padrão de todos os parâmetros, para inicializar o editor (M05). */
export function defaultParameterValues(params: readonly Parameter[]): ParameterValues {
  return Object.fromEntries(params.map((p) => [p.key, p.default]));
}

/**
 * Valida valores informados pelo usuário contra o esquema de parâmetros.
 * Chaves desconhecidas são rejeitadas; ausentes recebem default.
 */
export function validateParameterValues(
  params: readonly Parameter[],
  values: ParameterValues,
): { ok: true; values: ParameterValues } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const out: ParameterValues = {};
  const byKey = new Map(params.map((p) => [p.key, p]));
  for (const k of Object.keys(values)) {
    if (!byKey.has(k)) issues.push({ path: k, message: "parâmetro desconhecido" });
  }
  for (const p of params) {
    const v = hasOwn(values, p.key) ? values[p.key] : p.default;
    const err = checkValue(p, v);
    if (err) issues.push({ path: p.key, message: err });
    else out[p.key] = v;
  }
  return issues.length ? { ok: false, issues } : { ok: true, values: out };
}

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

function checkValue(p: Parameter, v: unknown): string | null {
  const range = (n: number, min?: number, max?: number) =>
    min !== undefined && n < min ? `mínimo ${min}` : max !== undefined && n > max ? `máximo ${max}` : null;
  switch (p.type) {
    case "string":
    case "richText":
    case "font":
      if (typeof v !== "string") return "esperado texto";
      if ("maxLength" in p && p.maxLength !== undefined && v.length > p.maxLength) return `máximo ${p.maxLength} caracteres`;
      return null;
    case "color":
      return typeof v === "string" && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? null : "cor inválida";
    case "number":
    case "duration":
    case "scale":
      if (typeof v !== "number" || !Number.isFinite(v)) return "esperado número";
      return range(v, p.min, p.max);
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) return "esperado inteiro";
      return range(v, p.min, p.max);
    case "enum":
      return typeof v === "string" && p.options.includes(v) ? null : "opção inválida";
    case "bool":
      return typeof v === "boolean" ? null : "esperado verdadeiro/falso";
    case "assetRef":
      return v === null || typeof v === "string" ? null : "referência inválida";
    case "position":
      return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n >= 0 && n <= 1)
        ? null
        : "posição deve ser [x, y] normalizado 0–1";
    case "easing":
      return typeof v === "string" && (EASINGS as readonly string[]).includes(v) ? null : "easing inválido";
  }
}
