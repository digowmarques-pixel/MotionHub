/** Categorias, estados e hosts de assets (Especificação §5 M01, M12). */
export const ASSET_TYPES = [
  "title",
  "text",
  "transition",
  "shape",
  "overlay",
  "sfx",
  "caption",
  "timer",
  "media",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Fluxo rascunho → revisão → publicado, com descontinuação lógica. */
export const ASSET_STATES = ["draft", "review", "published", "deprecated"] as const;
export type AssetState = (typeof ASSET_STATES)[number];

export const ASSET_TRANSITIONS: Record<AssetState, readonly AssetState[]> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["deprecated"],
  deprecated: ["published"],
};

export function canTransition(from: AssetState, to: AssetState): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

export const HOSTS = ["premiere", "after-effects"] as const;
export type HostName = (typeof HOSTS)[number];

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5", "any"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Papel de cada arquivo dentro de uma versão (AssetFile.role). */
export const FILE_ROLES = ["template", "media", "audio", "preview", "poster", "font", "subtitle"] as const;
export type FileRole = (typeof FILE_ROLES)[number];
