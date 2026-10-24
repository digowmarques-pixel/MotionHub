import type { ApplyState, AssetType } from "@motionhub/shared";
import type { Category } from "../core/catalog.js";

export const CATEGORY_LABELS: Array<[Category, string]> = [
  ["all", "Todos"],
  ["title", "Títulos"],
  ["text", "Texto"],
  ["transition", "Transições"],
  ["shape", "Shapes"],
  ["overlay", "Overlays"],
  ["sfx", "SFX"],
  ["caption", "Legendas"],
  ["timer", "Timers"],
  ["media", "Mídias"],
  ["favourites", "★ Favoritos"],
  ["recent", "Recentes"],
];

export const TYPE_LABEL: Record<AssetType, string> = {
  title: "Título",
  text: "Texto",
  transition: "Transição",
  shape: "Shape",
  overlay: "Overlay",
  sfx: "SFX",
  caption: "Legenda",
  timer: "Timer",
  media: "Mídia",
};

export const STATE_LABEL: Record<ApplyState, string> = {
  idle: "Preparando…",
  compatibility_checked: "Compatibilidade verificada",
  downloading: "Baixando e verificando integridade…",
  validating: "Validando arquivos…",
  preparing_host: "Lendo projeto e sequência…",
  inserting: "Inserindo na sequência…",
  verifying: "Conferindo resultado…",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};
