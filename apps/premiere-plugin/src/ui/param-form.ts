/** Editor de parâmetros gerado a partir do esquema tipado (M05). */
import { EASINGS, validateParameterValues, type Parameter, type ParameterValues } from "@motionhub/shared";
import { h } from "./dom.js";

export interface ParamForm {
  el: HTMLElement;
  values(): ParameterValues;
  valid(): boolean;
  reset(): void;
}

export function createParamForm(params: readonly Parameter[], initial: ParameterValues, onChange: () => void): ParamForm {
  let values: ParameterValues = { ...initial };
  const errors = new Map<string, HTMLElement>();
  const inputs = new Map<string, () => void>();
  const el = h("form", { class: "params", onsubmit: (e: Event) => e.preventDefault() });

  const update = (key: string, v: unknown) => {
    values = { ...values, [key]: v };
    validate();
    onChange();
  };

  const validate = () => {
    const r = validateParameterValues(params, values);
    for (const [k, e] of errors) {
      const issue = r.ok ? undefined : r.issues.find((i) => i.path === k);
      e.textContent = issue?.message ?? "";
      e.hidden = !issue;
    }
    return r.ok;
  };

  const groups = new Map<string, HTMLElement>();
  for (const p of params) {
    const id = `param-${p.key}`;
    const label = p.label ?? p.key;
    const err = h("div", { class: "field-error", role: "alert", hidden: true });
    errors.set(p.key, err);
    const control = renderControl(p, id, () => values[p.key], (v) => update(p.key, v), inputs);
    const field = h("div", { class: "field", title: p.tooltip ?? null }, h("label", { for: id }, label), control, err);
    const gname = p.group ?? "";
    let group = groups.get(gname);
    if (!group) {
      group = gname ? h("fieldset", { class: "group" }, h("legend", {}, gname)) : h("div", { class: "group" });
      groups.set(gname, group);
      el.append(group);
    }
    group.append(field);
  }
  validate();

  return {
    el,
    values: () => ({ ...values }),
    valid: validate,
    reset() {
      values = Object.fromEntries(params.map((p) => [p.key, p.default]));
      for (const sync of inputs.values()) sync();
      validate();
      onChange();
    },
  };
}

function renderControl(p: Parameter, id: string, get: () => unknown, set: (v: unknown) => void, syncers: Map<string, () => void>): HTMLElement {
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  switch (p.type) {
    case "string":
    case "font": {
      const i = h("input", { id, type: "text", maxlength: p.type === "string" ? (p.maxLength ?? null) : null, value: String(get() ?? ""), oninput: (e: Event) => set((e.target as HTMLInputElement).value) });
      syncers.set(p.key, () => (i.value = String(get() ?? "")));
      return i;
    }
    case "richText": {
      const t = h("textarea", { id, rows: 3, maxlength: p.maxLength ?? null, oninput: (e: Event) => set((e.target as HTMLTextAreaElement).value) });
      t.value = String(get() ?? "");
      syncers.set(p.key, () => (t.value = String(get() ?? "")));
      return t;
    }
    case "color": {
      const swatch = h("span", { class: "swatch", "aria-hidden": "true" });
      const paint = () => (swatch.style.background = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(get())) ? String(get()).slice(0, 7) : "transparent");
      const i = h("input", { id, type: "text", value: String(get()), placeholder: "#RRGGBB", oninput: (e: Event) => { set((e.target as HTMLInputElement).value.trim()); paint(); } });
      paint();
      syncers.set(p.key, () => { i.value = String(get()); paint(); });
      return h("div", { class: "color-input" }, swatch, i);
    }
    case "number":
    case "int":
    case "duration":
    case "scale": {
      const step = p.type === "int" ? 1 : "step" in p && p.step ? p.step : p.type === "duration" ? 0.1 : 0.01;
      const i = h("input", { id, type: "number", step, min: "min" in p ? (p.min ?? null) : null, max: "max" in p ? (p.max ?? null) : null, value: String(get()), oninput: (e: Event) => set(num((e.target as HTMLInputElement).value)) });
      syncers.set(p.key, () => (i.value = String(get())));
      const unit = p.type === "duration" ? " s" : p.type === "scale" ? " ×" : "";
      return unit ? h("div", { class: "with-unit" }, i, h("span", { class: "unit" }, unit)) : i;
    }
    case "enum":
    case "easing": {
      const options = p.type === "enum" ? p.options : EASINGS;
      const s = h("select", { id, onchange: (e: Event) => set((e.target as HTMLSelectElement).value) }, ...options.map((o) => h("option", { value: o }, o)));
      s.value = String(get());
      syncers.set(p.key, () => (s.value = String(get())));
      return s;
    }
    case "bool": {
      const c = h("input", { id, type: "checkbox", checked: Boolean(get()), onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
      syncers.set(p.key, () => (c.checked = Boolean(get())));
      return c;
    }
    case "position": {
      const cur = () => (get() as [number, number]) ?? [0.5, 0.5];
      const x = h("input", { id, type: "number", step: 0.01, min: 0, max: 1, "aria-label": "X", value: cur()[0], oninput: () => set([num(x.value), num(y.value)]) });
      const y = h("input", { type: "number", step: 0.01, min: 0, max: 1, "aria-label": "Y", value: cur()[1], oninput: () => set([num(x.value), num(y.value)]) });
      syncers.set(p.key, () => { x.value = String(cur()[0]); y.value = String(cur()[1]); });
      return h("div", { class: "xy" }, h("span", {}, "X"), x, h("span", {}, "Y"), y);
    }
    case "assetRef": {
      const i = h("input", { id, type: "text", value: String(get() ?? ""), oninput: (e: Event) => set((e.target as HTMLInputElement).value || null) });
      syncers.set(p.key, () => (i.value = String(get() ?? "")));
      return i;
    }
  }
}
