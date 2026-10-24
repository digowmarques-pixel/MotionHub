import { ASPECT_RATIOS, defaultParameterValues, type AspectRatio } from "@motionhub/shared";
import type { Platform } from "../platform/types.js";
import type { HostAdapter, HostContext, InsertOptions } from "../host/types.js";
import { ApiClient, ApiError, OfflineError } from "../core/api-client.js";
import { CatalogStore, type CatalogItem, type Category } from "../core/catalog.js";
import { AssetCache } from "../core/downloads.js";
import { applyAsset, compatibility } from "../core/apply.js";
import { $, clear, debounce, h } from "./dom.js";
import { CATEGORY_LABELS, STATE_LABEL, TYPE_LABEL } from "./labels.js";
import { createParamForm, type ParamForm } from "./param-form.js";

const PAGE = 60;
const LAST_SERVER = "motionhub.lastServer";

interface ViewState {
  query: string;
  category: Category;
  aspect: AspectRatio | "";
  sort: "relevance" | "name" | "updated";
  shown: number;
}

export class App {
  private api: ApiClient;
  private catalog: CatalogStore;
  private cache: AssetCache;
  private ctx: HostContext | null = null;
  private view: ViewState = { query: "", category: "all", aspect: "", sort: "relevance", shown: PAGE };
  private results: CatalogItem[] = [];
  private total = 0;
  private selected: CatalogItem | null = null;
  private form: ParamForm | null = null;
  private busy = false;
  private activeVideo: HTMLVideoElement | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly platform: Platform,
    private readonly host: HostAdapter,
  ) {
    this.api = new ApiClient(platform);
    this.catalog = new CatalogStore(platform, this.api);
    this.cache = new AssetCache(platform, this.api);
  }

  async start(): Promise<void> {
    await Promise.all([this.catalog.load(), this.cache.load()]);
    if (await this.api.restore()) {
      this.renderShell();
      void this.sync();
    } else {
      await this.renderLogin();
    }
  }

  // ---------- Login ----------
  private async renderLogin(error?: string): Promise<void> {
    this.stopPolling();
    clear(this.root);
    const server = (await this.platform.readText(LAST_SERVER)) ?? "";
    const err = h("div", { class: "login-error", role: "alert", hidden: !error }, error ?? "");
    const submit = async (e: Event) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const btn = $<HTMLButtonElement>(f, "button");
      const data = new FormData(f);
      btn.disabled = true;
      err.hidden = true;
      try {
        const url = String(data.get("server")).trim();
        await this.api.login(url, String(data.get("email")), String(data.get("password")));
        await this.platform.writeText(LAST_SERVER, url);
        this.renderShell();
        void this.sync();
      } catch (ex) {
        err.textContent = ex instanceof OfflineError ? "Não foi possível conectar ao servidor. Verifique o endereço e a rede." : (ex as Error).message;
        err.hidden = false;
        btn.disabled = false;
      }
    };
    this.root.append(
      h("form", { class: "login", onsubmit: submit },
        h("div", { class: "brand" }, h("span", { class: "logo" }, "M"), h("div", {}, h("strong", {}, "Motion Hub"), h("small", {}, "Megalume"))),
        h("label", { for: "server" }, "Servidor"),
        h("input", { id: "server", name: "server", type: "url", required: true, placeholder: "https://motionhub.megalume.com.br", value: server }),
        h("label", { for: "email" }, "E-mail"),
        h("input", { id: "email", name: "email", type: "email", required: true, autocomplete: "username" }),
        h("label", { for: "password" }, "Senha"),
        h("input", { id: "password", name: "password", type: "password", required: true, autocomplete: "current-password" }),
        err,
        h("button", { type: "submit", class: "primary" }, "Entrar"),
      ),
    );
    $<HTMLInputElement>(this.root, server ? "#email" : "#server").focus();
  }

  // ---------- Estrutura principal ----------
  private renderShell(): void {
    clear(this.root);
    const search = h("input", {
      id: "search",
      type: "search",
      placeholder: "Buscar títulos, transições, SFX…",
      "aria-label": "Buscar",
      value: this.view.query,
      oninput: debounce((e: Event) => {
        this.view.query = (e.target as HTMLInputElement).value;
        this.refresh();
      }, 120),
    });
    const chips = h("nav", { class: "chips", "aria-label": "Categorias" },
      ...CATEGORY_LABELS.map(([c, label]) =>
        h("button", { type: "button", class: "chip", "data-cat": c, "aria-pressed": String(c === this.view.category), onclick: () => this.setCategory(c) }, label),
      ),
    );
    const aspect = h("select", { "aria-label": "Proporção", onchange: (e: Event) => { this.view.aspect = (e.target as HTMLSelectElement).value as AspectRatio | ""; this.refresh(); } },
      h("option", { value: "" }, "Proporção: todas"),
      ...ASPECT_RATIOS.filter((a) => a !== "any").map((a) => h("option", { value: a }, a)),
    );
    const sort = h("select", { "aria-label": "Ordenar", onchange: (e: Event) => { this.view.sort = (e.target as HTMLSelectElement).value as ViewState["sort"]; this.refresh(); } },
      h("option", { value: "relevance" }, "Relevância"),
      h("option", { value: "name" }, "Nome"),
      h("option", { value: "updated" }, "Mais recentes"),
    );
    const grid = h("main", { class: "grid", id: "grid", onscroll: () => this.maybeLoadMore() });

    this.root.append(
      h("header", { class: "top" },
        search,
        h("button", { type: "button", class: "icon", id: "sync", title: "Sincronizar catálogo", "aria-label": "Sincronizar", onclick: () => this.sync() }, "⟳"),
        h("button", { type: "button", class: "text-btn", title: `Sair (${this.api.user?.name ?? ""})`, onclick: () => this.logout() }, "Sair"),
      ),
      chips,
      h("div", { class: "filters" }, aspect, sort, h("span", { id: "count", class: "count", "aria-live": "polite" })),
      grid,
      h("section", { class: "detail", id: "detail", hidden: true, "aria-label": "Detalhes do asset" }),
      h("footer", { class: "ctx", id: "ctx" },
        h("span", { class: "dot", id: "net" }),
        h("span", { id: "ctx-text" }, "Lendo Premiere…"),
        h("button", { type: "button", class: "lib-btn", id: "lib", onclick: () => this.connectLibrary() }),
      ),
    );

    document.onkeydown = (e) => {
      if (e.key === "Escape" && this.selected) this.closeDetail();
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        search.focus();
      }
    };
    this.refresh();
    this.renderLibrary();
    this.startPolling();
  }

  private renderLibrary(): void {
    const b = this.root.querySelector<HTMLButtonElement>("#lib");
    if (!b) return;
    b.textContent = this.cache.libraryConnected ? "Biblioteca ✓" : "Conectar biblioteca";
    b.title = this.cache.libraryConnected
      ? "Usando os pacotes instalados pelo Gerenciador Motion Hub (funciona offline). Clique para trocar a pasta."
      : "Escolha a pasta da biblioteca do Gerenciador para usar os pacotes já instalados, sem baixar de novo.";
  }

  private async connectLibrary(): Promise<void> {
    try {
      const path = await this.platform.connectLibrary();
      if (!path) return;
      await this.cache.loadLibrary();
      this.renderLibrary();
      this.renderGrid();
    } catch (e) {
      const t = this.root.querySelector("#ctx-text");
      if (t) t.textContent = (e as Error).message;
    }
  }

  private setCategory(c: Category): void {
    this.view.category = c;
    for (const b of this.root.querySelectorAll<HTMLElement>(".chip")) b.setAttribute("aria-pressed", String(b.dataset.cat === c));
    this.refresh();
  }

  private async sync(): Promise<void> {
    const btn = this.root.querySelector<HTMLButtonElement>("#sync");
    btn?.classList.add("spin");
    const r = await this.catalog.sync();
    btn?.classList.remove("spin");
    const err = this.catalog.lastSyncError;
    if (err instanceof ApiError && err.status === 401) return this.renderLogin("Sua sessão expirou. Entre novamente.");
    if (r.changed || !this.results.length) this.refresh();
    this.renderNet();
  }

  private async logout(): Promise<void> {
    await this.api.logout();
    await this.renderLogin();
  }

  // ---------- Grade de resultados ----------
  private refresh(): void {
    this.view.shown = PAGE;
    const r = this.catalog.search(this.view.query, this.view.category, {
      aspectRatio: this.view.aspect || undefined,
      sort: this.view.query || this.view.sort !== "relevance" ? this.view.sort : undefined,
      limit: 10_000,
    });
    this.results = r.items;
    this.total = r.total;
    const grid = $(this.root, "#grid");
    if (!grid) return;
    grid.scrollTop = 0;
    this.renderGrid();
  }

  private renderGrid(): void {
    const grid = $(this.root, "#grid");
    this.stopVideo();
    clear(grid);
    const count = $(this.root, "#count");
    count.textContent = `${this.total} ${this.total === 1 ? "item" : "itens"}`;
    if (!this.results.length) {
      grid.append(this.emptyState());
      return;
    }
    for (const it of this.results.slice(0, this.view.shown)) grid.append(this.card(it));
  }

  private emptyState(): HTMLElement {
    if (!this.catalog.size) {
      return h("div", { class: "empty" },
        h("strong", {}, this.catalog.online ? "Catálogo vazio" : "Catálogo ainda não sincronizado"),
        h("p", {}, this.catalog.online ? "Nenhum asset publicado para sua equipe." : "Conecte-se à rede e clique em ⟳ para baixar o catálogo."),
      );
    }
    if (this.view.category === "favourites" && !this.view.query) return h("div", { class: "empty" }, h("strong", {}, "Sem favoritos"), h("p", {}, "Use ☆ nos cards para guardar seus itens."));
    return h("div", { class: "empty" }, h("strong", {}, "Nada encontrado"), h("p", {}, "Tente outro termo ou limpe os filtros."));
  }

  private maybeLoadMore(): void {
    const grid = $(this.root, "#grid");
    if (this.view.shown >= this.results.length) return;
    if (grid.scrollTop + grid.clientHeight < grid.scrollHeight - 300) return;
    const from = this.view.shown;
    this.view.shown += PAGE;
    for (const it of this.results.slice(from, this.view.shown)) grid.append(this.card(it));
  }

  private card(it: CatalogItem): HTMLElement {
    const installed = it.latestVersion ? this.cache.isInstalled(it.id, it.latestVersion) : false;
    const thumb = h("div", { class: "thumb" },
      it.posterUrl ? h("img", { src: it.posterUrl, alt: "", loading: "lazy", onerror: (e: Event) => ((e.target as HTMLElement).hidden = true) }) : null,
      h("span", { class: "badge" }, TYPE_LABEL[it.type]),
      it.durationSec ? h("span", { class: "dur" }, `${it.durationSec}s`) : null,
    );
    const star = h("button", {
      type: "button",
      class: `star${this.catalog.isFavourite(it.id) ? " on" : ""}`,
      "aria-label": this.catalog.isFavourite(it.id) ? "Remover dos favoritos" : "Adicionar aos favoritos",
      onclick: async (e: Event) => {
        e.stopPropagation();
        const on = await this.catalog.toggleFavourite(it.id);
        star.classList.toggle("on", on);
        star.textContent = on ? "★" : "☆";
        if (this.view.category === "favourites") this.refresh();
      },
    }, this.catalog.isFavourite(it.id) ? "★" : "☆");
    const card = h("div", {
      class: "card",
      tabindex: 0,
      role: "button",
      "aria-label": it.name,
      onclick: () => this.openDetail(it),
      onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") this.openDetail(it); },
      onmouseenter: () => this.playPreview(thumb, it),
      onmouseleave: () => this.stopVideo(),
    },
      thumb,
      h("div", { class: "meta" }, h("span", { class: "name", title: it.name }, it.name), star),
      h("div", { class: "sub" }, it.aspectRatio !== "any" ? it.aspectRatio : "", installed ? h("span", { class: "ok", title: "Disponível offline" }, " · ✓ offline") : ""),
    );
    return card;
  }

  /** Preview em hover: um único <video> ativo; descartado ao sair (evita vazamento de memória, M02). */
  private playPreview(container: HTMLElement, it: CatalogItem): void {
    if (!it.previewUrl || !it.previewUrl.includes(".mp4")) return;
    this.stopVideo();
    const v = h("video", { src: it.previewUrl, muted: true, loop: true, autoplay: true, playsinline: true, class: "hover-video" });
    v.muted = true;
    v.onerror = () => this.stopVideo();
    container.append(v);
    this.activeVideo = v;
    void v.play?.()?.catch?.(() => {});
  }

  private stopVideo(): void {
    const v = this.activeVideo;
    if (!v) return;
    v.pause?.();
    v.removeAttribute("src");
    v.load?.();
    v.remove();
    this.activeVideo = null;
  }

  // ---------- Detalhe + inserção ----------
  private openDetail(it: CatalogItem): void {
    this.selected = it;
    void this.catalog.markRecent(it.id);
    const d = $(this.root, "#detail");
    clear(d);
    d.hidden = false;
    this.stopVideo();

    const incompatible = compatibility(it, this.ctx?.hostVersion ?? "0");
    const preview = it.previewUrl
      ? it.previewUrl.includes(".mp4")
        ? h("video", { src: it.previewUrl, poster: it.posterUrl ?? null, controls: true, loop: true, muted: true, autoplay: true, class: "preview" })
        : h("div", { class: "preview audio" }, it.posterUrl ? h("img", { src: it.posterUrl, alt: "" }) : null, h("audio", { src: it.previewUrl, controls: true }))
      : h("div", { class: "preview empty-preview" }, "Sem preview");
    if (preview instanceof HTMLVideoElement) preview.onerror = () => preview.replaceWith(h("img", { class: "preview", src: it.posterUrl ?? "", alt: "Preview indisponível" }));

    this.form = createParamForm(it.manifest.parameters, defaultParameterValues(it.manifest.parameters), () => this.updateInsertButton());
    const isMogrt = it.manifest.assets.some((a) => a.role === "template");

    const status = h("div", { class: "status", id: "status", role: "status", "aria-live": "polite" });
    const insertBtn = h("button", { type: "button", class: "primary", id: "insert", onclick: () => this.insert() }, "Inserir na sequência");

    d.append(
      h("div", { class: "detail-head" },
        h("button", { type: "button", class: "icon", "aria-label": "Voltar", onclick: () => this.closeDetail() }, "←"),
        h("h2", {}, it.name),
        h("span", { class: "ver" }, `v${it.latestVersion}`),
      ),
      h("div", { class: "detail-body" },
        preview,
        it.summary ? h("p", { class: "summary" }, it.summary) : null,
        h("div", { class: "tags" }, ...it.tags.map((t) => h("span", { class: "tag" }, t))),
        incompatible ? h("div", { class: "warn" }, incompatible) : null,
        it.manifest.parameters.length
          ? h("details", { open: true }, h("summary", {}, "Parâmetros"), this.form.el, h("button", { type: "button", class: "link", onclick: () => this.form?.reset() }, "Restaurar padrões"))
          : null,
        h("details", { open: true }, h("summary", {}, "Inserção"), this.insertOptions(isMogrt)),
      ),
      h("div", { class: "detail-foot" }, status, insertBtn),
    );
    this.updateInsertButton();
    $<HTMLElement>(d, "button").focus();
  }

  private insertOptions(isMogrt: boolean): HTMLElement {
    const tracks = Math.max(this.ctx?.sequence?.videoTracks ?? 1, 1);
    const vOpts = [...Array.from({ length: tracks }, (_, i) => h("option", { value: i }, `V${i + 1}`)), h("option", { value: tracks }, "Nova faixa de vídeo")];
    const vSel = h("select", { id: "opt-vtrack" }, ...vOpts);
    vSel.value = String(isMogrt ? Math.min(1, tracks) : 0);
    return h("div", { class: "insert-opts" },
      h("div", { class: "field" }, h("label", { for: "opt-at" }, "Posição"),
        h("select", { id: "opt-at" }, h("option", { value: "playhead" }, "Na agulha (playhead)"), h("option", { value: "start" }, "Início da sequência"))),
      h("div", { class: "field" }, h("label", { for: "opt-vtrack" }, "Faixa de vídeo"), vSel),
      isMogrt ? null : h("div", { class: "field" }, h("label", { for: "opt-mode" }, "Modo"),
        h("select", { id: "opt-mode" }, h("option", { value: "overwrite" }, "Sobrescrever"), h("option", { value: "insert" }, "Inserir (empurra clipes)"))),
    );
  }

  private readOptions(): InsertOptions {
    const d = $(this.root, "#detail");
    const v = Number($<HTMLSelectElement>(d, "#opt-vtrack")?.value ?? 0);
    return {
      at: ($<HTMLSelectElement>(d, "#opt-at")?.value ?? "playhead") as "playhead" | "start",
      videoTrack: v,
      audioTrack: v,
      mode: ($<HTMLSelectElement>(d, "#opt-mode")?.value ?? "overwrite") as InsertOptions["mode"],
    };
  }

  private updateInsertButton(): void {
    const btn = this.root.querySelector<HTMLButtonElement>("#insert");
    if (!btn || !this.selected) return;
    const why = !this.ctx?.project ? "Abra um projeto no Premiere." : !this.ctx.sequence ? "Abra ou selecione uma sequência." : compatibility(this.selected, this.ctx.hostVersion) ?? (this.form && !this.form.valid() ? "Corrija os parâmetros destacados." : null);
    btn.disabled = this.busy || !!why;
    btn.title = why ?? "";
    const status = this.root.querySelector<HTMLElement>("#status");
    if (status && !this.busy && !status.dataset.final) status.textContent = why ?? "";
  }

  private async insert(): Promise<void> {
    const it = this.selected;
    if (!it || this.busy) return;
    this.busy = true;
    const status = $(this.root, "#status");
    delete status.dataset.final;
    status.className = "status";
    this.updateInsertButton();
    const outcome = await applyAsset(
      { item: it, values: this.form?.values() ?? {}, options: this.readOptions() },
      {
        host: this.host,
        cache: this.cache,
        hostVersion: this.ctx?.hostVersion ?? "0",
        onEvent: (e) => (status.textContent = STATE_LABEL[e.state]),
        onProgress: (done, total) => (status.textContent = `Baixando ${done}/${total} arquivo(s) e verificando integridade…`),
      },
    );
    this.busy = false;
    status.textContent = outcome.message;
    status.dataset.final = "1";
    status.className = `status ${outcome.op.state === "completed" ? "ok" : "error"}`;
    if (outcome.op.state !== "completed") status.title = `ID da operação: ${outcome.op.correlationId}`;
    this.updateInsertButton();
    // Telemetria mínima: só asset/versão/ação, nunca conteúdo do projeto (§9).
    if (it.currentVersionId) {
      void this.api
        .request("POST", "/v1/usage", { assetVersionId: it.currentVersionId, host: "premiere", action: outcome.op.state === "completed" ? "apply" : "apply_failed" })
        .catch(() => {});
    }
  }

  private closeDetail(): void {
    const d = $(this.root, "#detail");
    for (const m of d.querySelectorAll("video, audio")) {
      (m as HTMLMediaElement).pause?.();
      m.removeAttribute("src");
    }
    clear(d);
    d.hidden = true;
    this.selected = null;
    this.form = null;
    this.renderGrid();
  }

  // ---------- Contexto do Premiere ----------
  private startPolling(): void {
    this.stopPolling();
    const tick = async () => {
      try {
        this.ctx = await this.host.getContext();
      } catch {
        this.ctx = null;
      }
      this.renderContext();
    };
    void tick();
    this.pollTimer = setInterval(tick, 2500);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private renderContext(): void {
    const t = this.root.querySelector("#ctx-text");
    if (!t) return;
    const c = this.ctx;
    t.textContent = !c?.project
      ? "Nenhum projeto aberto"
      : !c.sequence
        ? `${c.project.name} · selecione uma sequência`
        : `${c.sequence.name} · ${c.sequence.width}×${c.sequence.height} · ${Number(c.sequence.fps.toFixed(3))} fps`;
    this.updateInsertButton();
  }

  private renderNet(): void {
    const n = this.root.querySelector<HTMLElement>("#net");
    if (!n) return;
    n.className = `dot ${this.catalog.online ? "online" : "offline"}`;
    n.title = this.catalog.online ? "Online — catálogo sincronizado" : `Offline — usando biblioteca local${this.catalog.lastSyncError ? ` (${this.catalog.lastSyncError.message})` : ""}`;
  }
}

