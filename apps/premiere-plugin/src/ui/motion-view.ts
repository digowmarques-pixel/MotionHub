/**
 * Aba "Movimento": presets que animam o próprio clipe selecionado na timeline
 * (zoom, deslizar, giro, 3D, desfoque, tremida, glitch e transições).
 */
import type { HostAdapter, HostContext } from "../host/types.js";
import { MOTION_CATEGORIES, MOTION_PRESETS, type MotionCategory, type MotionPreset } from "../core/motion/presets.js";
import { planAnim, planLoop, planTransition, type MotionMode } from "../core/motion/plan.js";
import { APPLY_ERROR_MESSAGES, ApplyError } from "@motionhub/shared";
import { btn, clear, debounce, h, setDisabled, show } from "./dom.js";

const SPEEDS = [["0.7", "Rápido"], ["1", "Normal"], ["1.4", "Suave"]] as const;
const MODES: Array<[MotionMode, string]> = [["in", "Entrada"], ["out", "Saída"], ["both", "Entrada + Saída"]];
/** Prévia: sprite vertical com FRAMES quadros de 144×81 (gerado por scripts/motion-previews.mjs). */
const FRAMES = 12;
const THUMB_H = 81;

/** Quadro mostrado parado: o meio do movimento diz mais que o primeiro (que costuma ser preto). */
const posterFrame = (p: MotionPreset) => (p.kind === "loop" ? 2 : p.kind === "transition" ? 4 : 3);

export class MotionView {
  readonly el: HTMLElement;
  private mode: MotionMode = "in";
  private speed = 1;
  private motionBlur = true;
  private category: MotionCategory | "all" = "all";
  private query = "";
  private busy = false;
  private grid: HTMLElement;
  private status: HTMLElement;
  private detail: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly host: HostAdapter, private readonly context: () => HostContext | null) {
    this.grid = h("div", { class: "grid-inner", id: "motion-grid" });
    this.status = h("div", { class: "status", id: "motion-status", role: "status", "aria-live": "polite" },
      "Selecione um ou mais clipes na timeline e clique num preset.");
    this.detail = h("div", { class: "hint motion-detail", id: "motion-detail" });
    const seg = <T extends string>(items: ReadonlyArray<readonly [T, string]>, value: T, on: (v: T) => void, id: string) => {
      const row = h("div", { class: "seg", id });
      for (const [v, label] of items) {
        row.append(btn({ class: `seg-btn${v === value ? " is-on" : ""}`, "data-v": v, onclick: () => {
          for (const b of row.children) b.classList.toggle("is-on", (b as HTMLElement).dataset.v === v);
          on(v);
        } }, label));
      }
      return row;
    };
    const chips = h("div", { class: "chips", id: "motion-chips" },
      ...[["all", "Todos"] as const, ...MOTION_CATEGORIES].map(([c, label]) => {
        const n = c === "all" ? MOTION_PRESETS.length : MOTION_PRESETS.filter((p) => p.category === c).length;
        return btn({ class: `chip${c === this.category ? " is-on" : ""}`, "data-mcat": c, onclick: () => {
          this.category = c;
          for (const b of chips.children) b.classList.toggle("is-on", (b as HTMLElement).dataset.mcat === c);
          this.render();
        } }, `${label} ${n}`);
      }),
    );
    const blurToggle = btn({ class: "seg-btn is-on", id: "motion-blur", title: "Desfoque de movimento (ângulo do obturador)", onclick: () => {
      this.motionBlur = !this.motionBlur;
      blurToggle.classList.toggle("is-on", this.motionBlur);
    } }, "Desfoque de movimento");
    const search = h("input", { type: "text", placeholder: "Buscar movimento…", "aria-label": "Buscar movimento", oninput: debounce((e: Event) => {
      this.query = (e.target as HTMLInputElement).value;
      this.render();
    }, 120) });

    this.el = h("div", { class: "motion is-hidden", id: "motion" },
      h("div", { class: "motion-bar" },
        seg(MODES, this.mode, (v) => (this.mode = v), "motion-mode"),
        seg(SPEEDS, "1", (v) => (this.speed = Number(v)), "motion-speed"),
        blurToggle,
      ),
      h("div", { class: "top" }, search),
      chips,
      h("div", { class: "grid", id: "motion-scroll" }, this.grid),
      h("div", { class: "detail-foot" }, this.status, this.detail),
    );
    this.render();
  }

  setVisible(on: boolean): void {
    show(this.el, on);
    if (!on) this.stopPreview();
  }

  private results(): MotionPreset[] {
    const q = this.query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return MOTION_PRESETS.filter((p) => (this.category === "all" || p.category === this.category) &&
      (!q || `${p.name} ${p.keywords?.join(" ") ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)));
  }

  private render(): void {
    this.stopPreview();
    clear(this.grid);
    const list = this.results();
    if (!list.length) {
      this.grid.append(h("div", { class: "empty" }, h("div", { class: "empty-title" }, "Nada encontrado")));
      return;
    }
    for (const p of list) this.grid.append(this.card(p));
  }

  private card(p: MotionPreset): HTMLElement {
    const sprite = h("img", { class: "sprite", src: `motion-previews/${p.id}.jpg`, alt: "", onerror: (e: Event) => show(e.target as Element, false) });
    const rest = posterFrame(p);
    sprite.style.marginTop = `${-rest * THUMB_H}px`;
    const badge = p.kind === "transition" ? "TRANSIÇÃO" : p.kind === "loop" ? "CLIPE TODO" : "IN · OUT";
    const card = h("div", { class: "card motion-card", role: "button", tabindex: 0, "aria-label": p.name, "data-id": p.id,
      onclick: () => void this.apply(p),
      onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") void this.apply(p); },
      onmouseenter: () => this.startPreview(sprite),
      onmouseleave: () => this.stopPreview(sprite, rest),
    },
      h("div", { class: "thumb sprite-box" }, sprite),
      h("div", { class: "meta" }, h("div", { class: "name", title: p.name }, p.name)),
      h("div", { class: "sub" }, badge),
    );
    return card;
  }

  private startPreview(img: HTMLElement): void {
    this.stopPreview();
    let f = 0;
    this.timer = setInterval(() => {
      f = (f + 1) % FRAMES;
      img.style.marginTop = `${-f * THUMB_H}px`;
    }, 70);
  }

  private stopPreview(img?: HTMLElement, rest = 0): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (img) img.style.marginTop = `${-rest * THUMB_H}px`;
  }

  private async apply(p: MotionPreset): Promise<void> {
    if (this.busy) return;
    const ctx = this.context();
    if (!ctx?.project || !ctx.sequence) {
      this.say(!ctx?.project ? "Abra um projeto no Premiere." : "Abra ou selecione uma sequência.", "error");
      return;
    }
    this.busy = true;
    for (const c of this.grid.querySelectorAll(".motion-card")) setDisabled(c, true);
    this.say(`Aplicando "${p.name}"…`);
    try {
      const speed = this.speed, mode = this.mode, blur = this.motionBlur;
      const job =
        p.kind === "transition"
          ? (() => { const t = planTransition(p, p.duration * speed, ctx.sequence!.fps, blur); return { kind: "pair" as const, label: p.name, a: t.a, b: t.b }; })()
          : { kind: "each" as const, label: p.name, build: ({ duration, fps }: { duration: number; fps: number }) => {
              if (p.kind === "loop") return planLoop(p, duration, fps, blur);
              // Clipe curto: o trecho não pode passar do clipe (nem se sobrepor em Entrada + Saída).
              const max = mode === "both" ? duration / 2 : duration;
              return planAnim(p, mode, Math.min(p.duration * speed, max), fps, blur);
            } };
      const r = await this.host.applyMotion(job);
      const what = p.kind === "transition" ? `transição em ${r.clips} clipes` : `${r.clips} ${r.clips === 1 ? "clipe" : "clipes"}`;
      this.say(`"${p.name}" aplicado em ${what}. Ctrl+Z ${r.undoSteps}× desfaz.${r.warnings.length ? ` Atenção: ${r.warnings.join(" ")}` : ""}`, r.warnings.length ? undefined : "ok");
      this.detail.textContent = `${r.keyframes} keyframes · ${r.details}`;
    } catch (e) {
      const err = e instanceof ApplyError ? e : null;
      const base = err ? APPLY_ERROR_MESSAGES[err.code] : "Não foi possível aplicar.";
      const msg = (e as Error).message;
      this.say(msg && msg !== base ? (err?.code === "unsupported" ? msg : `${base} ${msg}`) : base, "error");
    } finally {
      this.busy = false;
      for (const c of this.grid.querySelectorAll(".motion-card")) setDisabled(c, false);
    }
  }

  private say(text: string, kind?: "ok" | "error"): void {
    this.status.textContent = text;
    this.status.className = `status${kind ? ` ${kind}` : ""}`;
  }
}
