/** Modo pasta: adicionar um efeito à biblioteca pelo próprio painel (copia para o NAS e cria o item.json). */
import { ASSET_TYPES, roleForFile, slugify, type AssetType } from "@motionhub/shared";
import type { PickedFile, Platform } from "../platform/types.js";
import { h } from "./dom.js";
import { TYPE_LABEL } from "./labels.js";

const TYPE_BY_EXT: Record<string, AssetType> = { mogrt: "title", wav: "sfx", mp3: "sfx", aif: "sfx", aiff: "sfx" };

const safeFileName = (name: string): string => {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return `${slugify(dot > 0 ? name.slice(0, dot) : name)}${ext ? `.${ext}` : ""}`;
};
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

export function createAddForm(platform: Platform, cb: { onCancel: () => void; onAdded: (id: string) => void | Promise<void> }): HTMLElement {
  const files: { main: PickedFile | null; poster: PickedFile | null; preview: PickedFile | null } = { main: null, poster: null, preview: null };
  const status = h("div", { class: "status", role: "status", "aria-live": "polite" });
  const name = h("input", { id: "add-name", type: "text", maxlength: 120, required: true }) as HTMLInputElement;
  const type = h("select", { id: "add-type" }, ...ASSET_TYPES.map((t) => h("option", { value: t }, TYPE_LABEL[t]))) as HTMLSelectElement;
  const tags = h("input", { id: "add-tags", type: "text", placeholder: "ex.: institucional, clean" }) as HTMLInputElement;
  const summary = h("textarea", { id: "add-summary", rows: 2, maxlength: 500, placeholder: "Para que serve e como usar" }) as HTMLTextAreaElement;
  const save = h("button", { type: "submit", class: "primary", disabled: true }, "Adicionar à biblioteca") as HTMLButtonElement;

  const picker = (slot: keyof typeof files, label: string, kind: "any" | "image" | "video", hint: string) => {
    const shown = h("span", { class: "picked" }, "nenhum arquivo");
    const btn = h("button", {
      type: "button",
      onclick: async () => {
        const f = await platform.pickFile(kind);
        if (!f) return;
        files[slot] = f;
        shown.textContent = f.name;
        if (slot === "main") {
          if (!name.value.trim()) name.value = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
          type.value = TYPE_BY_EXT[extOf(f.name)] ?? type.value;
        }
        save.disabled = !files.main || !name.value.trim();
      },
    }, "Escolher…");
    return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "pick-row" }, btn, shown), h("small", { class: "hint" }, hint));
  };

  name.addEventListener("input", () => (save.disabled = !files.main || !name.value.trim()));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!files.main || !name.value.trim()) return;
    save.disabled = true;
    status.className = "status";
    status.textContent = "Copiando para a biblioteca…";
    try {
      const lib = await platform.folderLibrary();
      if (!lib) throw new Error("Nenhuma pasta de biblioteca conectada.");
      const mainName = safeFileName(files.main.name);
      const copies: Array<{ as: string; file: PickedFile }> = [{ as: mainName, file: files.main }];
      const item: Record<string, unknown> = {
        name: name.value.trim(),
        type: type.value,
        summary: summary.value.trim() || undefined,
        tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean),
        main: mainName,
        role: roleForFile(mainName),
        license: "megalume-internal",
        addedAt: new Date().toISOString(),
      };
      if (files.poster) {
        const p = `poster.${extOf(files.poster.name)}`;
        copies.push({ as: p, file: files.poster });
        item.poster = p;
      }
      if (files.preview) {
        const p = `preview.${extOf(files.preview.name)}`;
        copies.push({ as: p, file: files.preview });
        item.preview = p;
      }
      // Sem "id": o id vem do nome da pasta criada, que é sempre único.
      const dir = await lib.addItem(slugify(name.value), copies, JSON.stringify(item, null, 2));
      status.className = "status ok";
      status.textContent = "Adicionado. Já aparece para todos os editores.";
      await cb.onAdded(slugify(dir));
    } catch (ex) {
      status.className = "status error";
      status.textContent = `Não foi possível adicionar: ${(ex as Error).message}`;
      save.disabled = false;
    }
  };

  return h("form", { class: "add-form", onsubmit: submit },
    h("div", { class: "detail-head" },
      h("button", { type: "button", class: "icon", "aria-label": "Voltar", onclick: cb.onCancel }, "←"),
      h("h2", {}, "Adicionar à biblioteca"),
    ),
    h("div", { class: "detail-body" },
      picker("main", "Arquivo do efeito *", "any", ".mogrt, .mov, .mp4, .wav, .mp3, .png…"),
      h("div", { class: "field" }, h("label", { for: "add-name" }, "Nome *"), name),
      h("div", { class: "field" }, h("label", { for: "add-type" }, "Tipo"), type),
      h("div", { class: "field" }, h("label", { for: "add-tags" }, "Tags (separe por vírgula)"), tags),
      h("div", { class: "field" }, h("label", { for: "add-summary" }, "Descrição"), summary),
      picker("poster", "Miniatura (opcional)", "image", "JPG ou PNG pequeno (até ~300 KB). Aparece no card."),
      picker("preview", "Preview (opcional)", "video", "MP4 curto (até 10 s) mostrado ao abrir o item."),
    ),
    h("div", { class: "detail-foot" }, status, save),
  );
}
