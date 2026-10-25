import type { ApplyState, AssetType } from "@motionhub/shared";
import type { Category } from "../core/catalog.js";

export const CATEGORY_LABELS: Array<[Category, string]> = [
  ["all", "Todos"],
  ["favourites", "★ Favoritos"],
  ["recent", "Recentes"],
  ["title", "Títulos"],
  ["text", "Texto"],
  ["transition", "Transições"],
  ["social", "Redes Sociais"],
  ["icon", "Ícones"],
  ["fx", "Efeitos 2D"],
  ["handdrawn", "Desenhado à Mão"],
  ["shape", "Formas"],
  ["overlay", "Overlays"],
  ["background", "Fundos"],
  ["texture", "Texturas"],
  ["timer", "Contadores"],
  ["sfx", "Sons"],
  ["caption", "Legendas"],
  ["media", "Mídias"],
];

export const TYPE_LABEL: Record<AssetType, string> = {
  title: "Título",
  text: "Texto",
  transition: "Transição",
  shape: "Forma",
  overlay: "Overlay",
  sfx: "Som",
  caption: "Legenda",
  timer: "Contador",
  media: "Mídia",
  social: "Social",
  icon: "Ícone",
  fx: "Efeito 2D",
  handdrawn: "À mão",
  texture: "Textura",
  background: "Fundo",
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
