export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Cria elemento: h("div", { class: "x", onclick: fn }, filhos...). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "value" && "value" in el) (el as HTMLInputElement).value = String(v);
    else if (k === "checked" && "checked" in el) (el as HTMLInputElement).checked = Boolean(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ---------------------------------------------------------------------------
// Componentes seguros para o UXP (Premiere): o painel não é um navegador completo.
// <button>, <select> e <details> ganham aparência nativa da Adobe que o CSS não controla,
// e o atributo "hidden" não é confiável. Por isso usamos <div> com papel acessível.
// ---------------------------------------------------------------------------

/** Mostra/esconde por classe (não depende do atributo hidden). */
export function show(el: Element | null | undefined, on: boolean): void {
  if (!el) return;
  el.classList.toggle("is-hidden", !on);
  // Estilo inline vence qualquer regra do CSS (ex.: ".browse { display: flex }" declarada depois).
  (el as HTMLElement).style.display = on ? "" : "none";
}

export function isShown(el: Element): boolean {
  return !el.classList.contains("is-hidden");
}

/** Botão feito de <div>: clique, Enter e Espaço; respeita "desabilitado". */
export function btn(attrs: Attrs & { class?: string; onclick?: EventListener }, ...children: Child[]): HTMLDivElement {
  const { onclick, class: cls, ...rest } = attrs;
  const el = h("div", { ...rest, class: `btn ${cls ?? ""}`.trim(), role: "button", tabindex: 0 }, ...children);
  el.addEventListener("click", (e) => {
    if (el.classList.contains("is-disabled")) return;
    (onclick as EventListener | undefined)?.(e);
  });
  el.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      el.click();
    }
  });
  return el;
}

export function setDisabled(el: Element, disabled: boolean): void {
  el.classList.toggle("is-disabled", disabled);
  el.setAttribute("aria-disabled", String(disabled));
}

export interface SelectControl {
  el: HTMLDivElement;
  value: string;
}

/**
 * Menu de seleção feito de <div>. A lista abre logo abaixo, no fluxo da página
 * (sem posicionamento absoluto), para funcionar igual no Premiere e no navegador.
 */
export function createSelect(options: Array<[string, string]>, value: string, onChange: (v: string) => void, attrs: { id?: string; label?: string } = {}): SelectControl {
  let current = options.some(([v]) => v === value) ? value : (options[0]?.[0] ?? "");
  const text = h("span", { class: "select-text" });
  const menu = h("div", { class: "select-menu is-hidden", role: "listbox" });
  const box = btn({ class: "select-box", id: attrs.id, "aria-label": attrs.label ?? null, "aria-haspopup": "listbox", onclick: () => toggle() }, text, h("span", { class: "select-caret" }, "▾"));
  const el = h("div", { class: "select" }, box, menu);

  const paint = () => {
    text.textContent = options.find(([v]) => v === current)?.[1] ?? "";
    for (const item of menu.children) item.classList.toggle("is-selected", (item as HTMLElement).dataset.value === current);
  };
  const toggle = (open = !isShown(menu)) => {
    // Fecha qualquer outro menu aberto.
    if (open) for (const m of document.querySelectorAll(".select-menu")) if (m !== menu) show(m, false);
    show(menu, open);
  };
  for (const [v, label] of options) {
    const item = btn({ class: "select-item", role: "option", "data-value": v, onclick: () => {
      current = v;
      paint();
      toggle(false);
      onChange(v);
    } }, label);
    menu.append(item);
  }
  paint();
  return {
    el,
    get value() {
      return current;
    },
    set value(v: string) {
      current = v;
      paint();
    },
  };
}
