/**
 * Formato de item da "biblioteca em pasta" (modo sem servidor, ex.: NAS do escritório).
 * Cada efeito fica numa subpasta com um item.json e seus arquivos:
 *
 *   MotionHub/
 *     light-leak-quente/
 *       item.json  light-leak-quente.mp4  preview.mp4  poster.png  thumb.jpg
 */
import { z } from "zod";
import { ASPECT_RATIOS, ASSET_TYPES, FILE_ROLES } from "./asset.js";
import { parameterSchema } from "./manifest.js";
import { isSafeRelativePath } from "./paths.js";

const fileName = z.string().min(1).max(200).refine(isSafeRelativePath, "nome de arquivo inválido");

export const folderItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/).optional(),
  name: z.string().min(1).max(120),
  type: z.enum(ASSET_TYPES),
  version: z.string().max(20).default("1.0.0"),
  summary: z.string().max(500).optional(),
  tags: z.array(z.string().max(40)).max(50).default([]),
  synonyms: z.array(z.string().max(40)).max(50).default([]),
  client: z.string().max(80).optional(),
  main: fileName,
  role: z.enum(FILE_ROLES).optional(),
  preview: fileName.optional(),
  poster: fileName.optional(),
  thumb: fileName.optional(),
  durationSec: z.number().positive().max(36000).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).default("any"),
  fps: z.number().positive().max(240).optional(),
  language: z.string().max(10).nullable().optional(),
  license: z.string().max(200).default("megalume-internal"),
  /** "deprecated" esconde da busca sem apagar (projetos antigos continuam funcionando). */
  state: z.enum(["published", "deprecated"]).default("published"),
  parameters: z.array(parameterSchema).default([]),
  addedAt: z.string().max(40).optional(),
});

export type FolderItem = z.infer<typeof folderItemSchema>;

export function roleForFile(name: string): "template" | "audio" | "media" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "mogrt" || ext === "aep") return "template";
  if (ext === "wav" || ext === "mp3" || ext === "aif" || ext === "aiff") return "audio";
  return "media";
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

export function parseFolderItem(raw: string): { ok: true; item: FolderItem } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "item.json não é um JSON válido" };
  }
  const r = folderItemSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") };
  return { ok: true, item: r.data };
}
