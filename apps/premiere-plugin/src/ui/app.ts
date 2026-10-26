import { ASPECT_RATIOS, defaultParameterValues, type AspectRatio } from "@motionhub/shared";
import type { Platform } from "../platform/types.js";
import type { HostAdapter, HostContext, InsertOptions } from "../host/types.js";
import { ApiClient, ApiError, OfflineError } from "../core/api-client.js";
import { CatalogStore, type CatalogItem, type Category } from "../core/catalog.js";
import { FolderSource, ServerSource } from "../core/sources.js";
import { createAddForm } from "./add-form.js";
import { AssetCache } from "../core/downloads.js";
import { applyAsset, compatibility } from "../core/apply.js";
import { $, btn, clear, createSelect, debounce, h, isShown, setDisabled, show, type SelectControl } from "./dom.js";
import { CATEGORY_LABELS, STATE_LABEL, TYPE_LABEL } from "./labels.js";
import { createParamForm, type ParamForm } from "./param-form.js";
import { MotionView } from "./motion-view.js";

const PAGE = 60;
const LAST_SERVER = "motionhub.lastServer";
const MODE_FILE = "mode.json";

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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private motion: MotionView | null = null;
  private tab: "library" | "motion" = "library";
  /** Modo pasta (NAS, sem servidor) ou servidor Motion Hub. */
  private folder: FolderSource | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly platform: Platform,
    private readonly host: HostAdapter,
  ) {
    this.api = new ApiClient(platform);
    this.catalog = new CatalogStore(platform, new ServerSource(this.api));
    this.cache = new AssetCache(platform, this.api);
  }

  async start(): Promise<void> {
    await this.cache.load();
    const mode = await this.platform.readText(MODE_FILE).catch(() => null);
    if (mode && JSON.parse(mode).mode === "folder") return this.enterFolderMode();
    await this.catalog.load();
    if (await this.api.restore()) {
      this.renderShell();
      void this.sync();
    } else {
      await this.renderLogin();
    }
  }

  // ---------- Modo pasta (NAS) ----------
  private async enterFolderMode(): Promise<void> {
    this.folder = new FolderSource(this.platform);
    this.catalog = new CatalogStore(this.platform, this.folder);
    await this.catalog.load();
    this.renderShell();
    await this.sync();
  }

  private async chooseFolder(): Promise<void> {
    try {
      const path = await this.platform.connectFolderLibrary();
      if (!path) return;
      await this.platform.writeText(MODE_FILE, JSON.stringify({ mode: "folder" }));
      await this.enterFolderMode();
    } catch (e) {
      const err = this.root.querySelector<HTMLElement>(".login-error");
      if (err) {
        err.textContent = (e as Error).message;
        show(err, true);
      }
    }
  }

  private openAddForm(): void {
    this.stopVideo();
    this.selected = null;
    $(this.root, "#detail").replaceChildren(
      createAddForm(this.platform, {
        onCancel: () => this.closeDetail(),
        onAdded: async (id) => {
          await this.sync();
          const it = this.catalog.get(id);
          if (it) this.openDetail(it);
          else this.closeDetail();
        },
      }),
    );
    this.showDetail(true);
  }

  /** Alterna entre a lista e a tela de detalhe (sem sobreposição absoluta: mais seguro no UXP). */
  private showDetail(on: boolean): void {
    show(this.root.querySelector("#browse"), !on && this.tab === "library");
    show(this.root.querySelector("#detail"), on && this.tab === "library");
  }

  private setTab(tab: "library" | "motion"): void {
    this.tab = tab;
    this.stopVideo();
    for (const [id, t] of [["#tab-library", "library"], ["#tab-motion", "motion"]] as const) this.root.querySelector(id)?.classList.toggle("is-on", t === tab);
    this.motion?.setVisible(tab === "motion");
    if (tab === "motion") {
      show(this.root.querySelector("#browse"), false);
      show(this.root.querySelector("#detail"), false);
    } else {
      this.showDetail(!!this.selected);
    }
  }

  // ---------- Login ----------
  private async renderLogin(error?: string): Promise<void> {
    this.stopPolling();
    clear(this.root);
    const server = (await this.platform.readText(LAST_SERVER)) ?? "";
    const err = h("div", { class: `login-error${error ? "" : " is-hidden"}`, role: "alert" }, error ?? "");
    const inServer = h("input", { id: "server", type: "text", placeholder: "https://motionhub.megalume.com.br", value: server }) as HTMLInputElement;
    const inEmail = h("input", { id: "email", type: "text", autocomplete: "username" }) as HTMLInputElement;
    const inPass = h("input", { id: "password", type: "password", autocomplete: "current-password" }) as HTMLInputElement;
    const enter = btn({ class: "secondary", id: "login-submit", onclick: () => void submit() }, "Entrar no servidor");
    const submit = async () => {
      setDisabled(enter, true);
      show(err, false);
      try {
        const url = inServer.value.trim();
        if (!url) throw new Error("Informe o endereço do servidor.");
        if (!inEmail.value.trim() || !inPass.value) throw new Error("Informe e-mail e senha.");
        await this.api.login(url, inEmail.value.trim(), inPass.value);
        await this.platform.writeText(LAST_SERVER, url);
        this.renderShell();
        void this.sync();
      } catch (ex) {
        err.textContent = ex instanceof OfflineError ? "Não foi possível conectar ao servidor. Verifique o endereço e a rede." : (ex as Error).message;
        show(err, true);
        setDisabled(enter, false);
      }
    };
    inPass.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") void submit();
    });
    // Opção principal: biblioteca numa pasta (NAS ou local). Servidor fica recolhido como alternativa.
    const serverOpen = !!server || !!error;
    const serverBox = h("div", { class: `server-box${serverOpen ? "" : " is-hidden"}` },
      h("label", { for: "server" }, "Servidor"), inServer,
      h("label", { for: "email" }, "E-mail"), inEmail,
      h("label", { for: "password" }, "Senha"), inPass,
      enter,
    );
    const toggle = btn({ class: "link", id: "server-toggle", onclick: () => show(serverBox, !isShown(serverBox)) }, "Usar um servidor Motion Hub ▾");
    this.root.append(
      h("div", { class: "login" },
        h("div", { class: "brand" }, h("div", { class: "logo" }, "M"), h("div", { class: "brand-text" }, h("div", { class: "brand-name" }, "Motion Hub"), h("div", { class: "brand-sub" }, "Megalume"))),
        btn({ class: "primary", id: "choose-folder", onclick: () => this.chooseFolder() }, "Escolher pasta da biblioteca"),
        h("div", { class: "hint" }, "Escolha a pasta onde ficam os efeitos: no NAS (ex.: \\\\NAS\\MotionHub) ou no computador (C:\\MotionHub). Só é preciso fazer isso uma vez."),
        err,
        toggle,
        serverBox,
      ),
    );
  }

  // ---------- Estrutura principal ----------
  private renderShell(): void {
    clear(this.root);
    const search = h("input", {
      id: "search",
      type: "text",
      placeholder: "Buscar efeitos…",
      "aria-label": "Buscar",
      value: this.view.query,
      oninput: debounce((e: Event) => {
        this.view.query = (e.target as HTMLInputElement).value;
        this.refresh();
      }, 120),
    });
    const chips = h("div", { class: "chips", role: "tablist", "aria-label": "Categorias" },
      ...CATEGORY_LABELS.map(([c, label]) =>
        btn({ class: `chip${c === this.view.category ? " is-on" : ""}`, "data-cat": c, role: "tab", "aria-selected": String(c === this.view.category), onclick: () => this.setCategory(c) }, label),
      ),
    );
    const aspect = createSelect([["", "Todos os formatos"], ...ASPECT_RATIOS.filter((a) => a !== "any").map((a) => [a, a] as [string, string])], this.view.aspect, (v) => {
      this.view.aspect = v as AspectRatio | "";
      this.refresh();
    }, { label: "Proporção" });
    const sort = createSelect([["relevance", "Relevância"], ["name", "Nome"], ["updated", "Mais recentes"]], this.view.sort, (v) => {
      this.view.sort = v as ViewState["sort"];
      this.refresh();
    }, { label: "Ordenar" });
    // A rolagem fica no .grid; os cards ficam num contêiner interno (no UXP, itens flex
    // dentro de um contêiner com rolagem encolhem até virar linhas).
    const grid = h("div", { class: "grid", id: "grid", onscroll: () => this.maybeLoadMore() }, h("div", { class: "grid-inner", id: "grid-inner" }));

    this.motion = new MotionView(this.host, () => this.ctx);
    const tabs = h("div", { class: "tabs", role: "tablist" },
      btn({ class: "tab is-on", id: "tab-library", role: "tab", onclick: () => this.setTab("library") }, "Biblioteca"),
      btn({ class: "tab", id: "tab-motion", role: "tab", onclick: () => this.setTab("motion") }, "Movimento"),
    );
    this.root.append(
      tabs,
      h("div", { class: "browse", id: "browse" },
        h("div", { class: "top" },
          search,
          this.folder ? btn({ class: "icon add", id: "add", title: "Adicionar efeito à biblioteca", "aria-label": "Adicionar efeito", onclick: () => this.openAddForm() }, "+") : null,
          btn({ class: "icon", id: "sync", title: this.folder ? "Recarregar a biblioteca" : "Sincronizar catálogo", "aria-label": "Atualizar", onclick: () => this.sync() }, "↻"),
          btn({ class: "text-btn", title: this.folder ? "Desconectar a pasta" : `Sair (${this.api.user?.name ?? ""})`, onclick: () => this.logout() }, "Sair"),
        ),
        chips,
        h("div", { class: "filters" }, aspect.el, sort.el, h("div", { id: "count", class: "count", "aria-live": "polite" })),
        grid,
      ),
      h("div", { class: "detail is-hidden", id: "detail", "aria-label": "Detalhes do efeito" }),
      this.motion.el,
      h("div", { class: "ctx", id: "ctx" },
        h("div", { class: "dot", id: "net" }),
        h("div", { id: "ctx-text", class: "ctx-text" }, "Lendo Premiere…"),
        this.folder ? null : btn({ class: "lib-btn", id: "lib", onclick: () => this.connectLibrary() }),
      ),
    );

    this.tab = "library";
    this.showDetail(false);
    document.onkeydown = (e) => {
      if (e.key === "Escape" && isShown($(this.root, "#detail"))) this.closeDetail();
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
    for (const b of this.root.querySelectorAll<HTMLElement>("#browse .chip")) {
      b.classList.toggle("is-on", b.dataset.cat === c);
      b.setAttribute("aria-selected", String(b.dataset.cat === c));
    }
    this.refresh();
  }

  private async sync(): Promise<void> {
    const syncBtn = this.root.querySelector<HTMLElement>("#sync");
    syncBtn?.classList.add("is-busy");
    const r = await this.catalog.sync();
    syncBtn?.classList.remove("is-busy");
    const err = this.catalog.lastSyncError;
    if (err instanceof ApiError && err.status === 401) return this.renderLogin("Sua sessão expirou. Entre novamente.");
    if (r.changed || !this.results.length || this.folder) this.refresh();
    this.renderNet();
  }

  private async logout(): Promise<void> {
    if (this.folder) {
      await this.platform.writeText(MODE_FILE, JSON.stringify({ mode: "server" }));
      this.folder = null;
      this.catalog = new CatalogStore(this.platform, new ServerSource(this.api));
      await this.catalog.load();
    } else {
      await this.api.logout();
    }
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

  /** Esconde categorias sem nenhum item (aparecem sozinhas quando alguém adicionar conteúdo). */
  private updateChips(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>("#browse .chip")) {
      const c = b.dataset.cat as Category;
      if (c === "all" || c === "favourites" || c === "recent" || c === this.view.category) {
        show(b, true);
        continue;
      }
      show(b, !(this.catalog.size > 0 && this.catalog.search("", c, { limit: 1 }).total === 0));
    }
  }

  private renderGrid(): void {
    this.updateChips();
    const grid = $(this.root, "#grid-inner");
    this.stopVideo();
    clear(grid);
    const count = $(this.root, "#count");
    const problems = this.folder?.problems ?? [];
    count.textContent = `${this.total} ${this.total === 1 ? "item" : "itens"}${problems.length ? ` · ⚠ ${problems.length} com problema` : ""}`;
    count.title = problems.map((p) => `${p.dir}: ${p.message}`).join("\n");
    if (!this.results.length) {
      grid.append(this.emptyState());
      return;
    }
    for (const it of this.results.slice(0, this.view.shown)) grid.append(this.card(it));
  }

  private emptyState(): HTMLElement {
    if (!this.catalog.size && this.folder) {
      return h("div", { class: "empty" },
        h("div", { class: "empty-title" }, this.catalog.online ? "Biblioteca vazia" : "Pasta da biblioteca indisponível"),
        h("div", { class: "empty-text" }, this.catalog.online ? "Use + para adicionar efeitos, ou copie as pastas do pacote inicial para a pasta da biblioteca e clique em ↻." : (this.catalog.lastSyncError?.message ?? "Verifique se o NAS está ligado.")),
      );
    }
    if (!this.catalog.size) {
      return h("div", { class: "empty" },
        h("div", { class: "empty-title" }, this.catalog.online ? "Catálogo vazio" : "Catálogo ainda não sincronizado"),
        h("div", { class: "empty-text" }, this.catalog.online ? "Nenhum asset publicado para sua equipe." : "Conecte-se à rede e clique em ↻ para baixar o catálogo."),
      );
    }
    if (this.view.category === "favourites" && !this.view.query) return h("div", { class: "empty" }, h("div", { class: "empty-title" }, "Sem favoritos"), h("div", { class: "empty-text" }, "Use ☆ nos cards para guardar seus itens."));
    return h("div", { class: "empty" }, h("div", { class: "empty-title" }, "Nada encontrado"), h("div", { class: "empty-text" }, "Tente outro termo ou limpe os filtros."));
  }

  private maybeLoadMore(): void {
    const grid = $(this.root, "#grid");
    if (this.view.shown >= this.results.length) return;
    if (grid.scrollTop + grid.clientHeight < grid.scrollHeight - 300) return;
    const from = this.view.shown;
    this.view.shown += PAGE;
    const inner = $(this.root, "#grid-inner");
    for (const it of this.results.slice(from, this.view.shown)) inner.append(this.card(it));
  }

  private card(it: CatalogItem): HTMLElement {
    const installed = !it.local && it.latestVersion ? this.cache.isInstalled(it.id, it.latestVersion) : false;
    // Miniatura com altura fixa e imagem centralizada (o UXP não suporta aspect-ratio nem object-fit).
    const thumb = h("div", { class: "thumb" },
      it.posterUrl ? h("img", { class: "thumb-img", src: it.posterUrl, alt: "", onerror: (e: Event) => show(e.target as Element, false) }) : h("div", { class: "thumb-empty" }, TYPE_LABEL[it.type]),
    );
    const fav = this.catalog.isFavourite(it.id);
    const star = btn({
      class: `star${fav ? " is-on" : ""}`,
      "aria-label": fav ? "Remover dos favoritos" : "Adicionar aos favoritos",
      onclick: async (e: Event) => {
        e.stopPropagation();
        const on = await this.catalog.toggleFavourite(it.id);
        star.classList.toggle("is-on", on);
        star.textContent = on ? "★" : "☆";
        if (this.view.category === "favourites") this.refresh();
      },
    }, fav ? "★" : "☆");
    const sub = [TYPE_LABEL[it.type], it.durationSec ? `${it.durationSec}s` : "", it.aspectRatio !== "any" ? it.aspectRatio : ""].filter(Boolean).join(" · ");
    return h("div", { class: "card", role: "button", tabindex: 0, "aria-label": it.name, onclick: () => this.openDetail(it), onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") this.openDetail(it); } },
      thumb,
      h("div", { class: "meta" }, h("div", { class: "name", title: it.name }, it.name), star),
      h("div", { class: "sub" }, sub, installed ? " · ✓ offline" : ""),
    );
  }

  private stopVideo(): void {
    for (const m of this.root.querySelectorAll("video, audio")) {
      (m as HTMLMediaElement).pause?.();
      m.removeAttribute("src");
    }
  }

  // ---------- Detalhe + inserção ----------
  private opts: { at: SelectControl; track: SelectControl; mode: SelectControl | null; fill: SelectControl | null } | null = null;

  private openDetail(it: CatalogItem): void {
    this.selected = it;
    void this.catalog.markRecent(it.id);
    const d = $(this.root, "#detail");
    this.stopVideo();
    clear(d);

    const incompatible = compatibility(it, this.ctx?.hostVersion ?? "0");
    // Começa pela miniatura; o vídeo/áudio de preview só é carregado se o editor pedir.
    const media = h("div", { class: "preview-box" },
      it.posterUrl ? h("img", { class: "preview", src: it.posterUrl, alt: "", onload: (e: Event) => fitImage(e.target as HTMLImageElement) }) : h("div", { class: "preview-empty" }, "Sem miniatura"),
    );
    const previewKind = (name: string | null | undefined): "video" | "audio" | "image" =>
      !name ? "video" : /\.(wav|mp3|aiff?)($|\?)/i.test(name) ? "audio" : /\.(png|jpe?g|webp)($|\?)/i.test(name) ? "image" : "video";
    const hasPreview = !!it.previewUrl || !!(it.folder?.preview && this.folder);
    const kind = previewKind(it.folder?.preview ?? it.previewUrl);
    const playBtn = hasPreview && kind !== "image"
      ? btn({ class: "secondary small", id: "play-preview", onclick: async () => {
          playBtn!.textContent = "Carregando…";
          const url = it.previewUrl ?? (await this.folder?.previewUrl(it).catch(() => null)) ?? null;
          if (!url || this.selected !== it) return;
          media.replaceChildren(previewElement(url, it.posterUrl, kind));
          show(playBtn!, false);
        } }, kind === "audio" ? "▶ Ouvir" : "▶ Ver animação")
      : null;

    this.form = createParamForm(it.manifest.parameters, defaultParameterValues(it.manifest.parameters), () => this.updateInsertButton());
    const isMogrt = it.manifest.assets.some((a) => a.role === "template");
    const status = h("div", { class: "status", id: "status", role: "status", "aria-live": "polite" });
    const insertBtn = btn({ class: "primary", id: "insert", onclick: () => this.insert() }, "Inserir na sequência");
    const section = (title: string, ...body: Array<Node | null>) => h("div", { class: "section" }, h("div", { class: "section-title" }, title), ...body);

    d.append(
      h("div", { class: "detail-head" },
        btn({ class: "icon", "aria-label": "Voltar", onclick: () => this.closeDetail() }, "←"),
        h("div", { class: "detail-title" }, it.name),
      ),
      h("div", { class: "detail-body" },
        media,
        playBtn,
        it.summary ? h("div", { class: "summary" }, it.summary) : null,
        h("div", { class: "tags" }, ...it.tags.slice(0, 8).map((t) => h("div", { class: "tag" }, t))),
        incompatible ? h("div", { class: "warn" }, incompatible) : null,
        this.formatWarning(it),
        it.manifest.parameters.length ? section("Parâmetros", this.form.el, btn({ class: "link", onclick: () => this.form?.reset() }, "Restaurar padrões")) : null,
        section("Inserção", this.insertOptions(isMogrt, it)),
      ),
      h("div", { class: "detail-foot" }, status, insertBtn),
    );
    this.showDetail(true);
    this.updateInsertButton();
  }

  /** Avisa quando o formato do efeito não bate com a sequência e oferece a versão certa. */
  private formatWarning(it: CatalogItem): HTMLElement | null {
    const seq = this.ctx?.sequence;
    if (!seq || it.aspectRatio === "any") return null;
    const want = aspectOf(seq.width, seq.height);
    if (!want || want === it.aspectRatio) return null;
    const base = baseName(it.name);
    const variant = this.catalog.search("", it.type, { limit: 10_000 }).items.find((o) => o.id !== it.id && o.aspectRatio === want && baseName(o.name) === base);
    return h("div", { class: "warn" },
      h("div", {}, `Este efeito é ${it.aspectRatio} e a sequência é ${want}: ele não vai preencher a tela.`),
      variant ? btn({ class: "link", onclick: () => this.openDetail(variant) }, `Usar a versão ${want}: ${variant.name} →`) : null,
    );
  }

  private insertOptions(isMogrt: boolean, it: CatalogItem): HTMLElement {
    const tracks = Math.max(this.ctx?.sequence?.videoTracks ?? 1, 1);
    const trackOpts: Array<[string, string]> = [...Array.from({ length: tracks }, (_, i) => [String(i), `V${i + 1}`] as [string, string]), [String(tracks), "Nova faixa de vídeo"]];
    const noop = () => {};
    this.opts = {
      at: createSelect([["playhead", "Na agulha (playhead)"], ["start", "Início da sequência"]], "playhead", noop, { id: "opt-at", label: "Posição" }),
      track: createSelect(trackOpts, String(isMogrt ? Math.min(1, tracks) : 0), noop, { id: "opt-vtrack", label: "Faixa de vídeo" }),
      mode: isMogrt ? null : createSelect([["overwrite", "Sobrescrever"], ["insert", "Inserir (empurra clipes)"]], "overwrite", noop, { id: "opt-mode", label: "Modo" }),
      fill: isMogrt || !LOOPABLE.has(it.type) ? null : createSelect([
        ["", it.durationSec ? `Original (${fmtSec(it.durationSec)})` : "Original"],
        ["10", "10 s"], ["30", "30 s"], ["60", "1 min"], ["300", "5 min"],
        ["end", "Até o fim da sequência"],
      ], "", noop, { id: "opt-fill", label: "Duração" }),
    };
    return h("div", { class: "insert-opts" },
      h("div", { class: "field" }, h("label", {}, "Posição"), this.opts.at.el),
      h("div", { class: "field" }, h("label", {}, "Faixa de vídeo"), this.opts.track.el),
      this.opts.mode ? h("div", { class: "field" }, h("label", {}, "Modo"), this.opts.mode.el) : null,
      this.opts.fill
        ? h("div", { class: "field" }, h("label", {}, "Duração"), this.opts.fill.el,
            h("div", { class: "hint" }, "Durações maiores repetem o efeito em sequência na faixa, sem emendas visíveis nos efeitos em loop."))
        : null,
    );
  }

  private readOptions(): InsertOptions {
    const v = Number(this.opts?.track.value ?? 0);
    return {
      at: (this.opts?.at.value ?? "playhead") as "playhead" | "start",
      videoTrack: v,
      audioTrack: v,
      mode: (this.opts?.mode?.value ?? "overwrite") as InsertOptions["mode"],
      fill: !this.opts?.fill?.value ? undefined : this.opts.fill.value === "end" ? "end" : Number(this.opts.fill.value),
    };
  }

  private updateInsertButton(): void {
    const insertBtn = this.root.querySelector<HTMLElement>("#insert");
    if (!insertBtn || !this.selected) return;
    const why = !this.ctx?.project ? "Abra um projeto no Premiere." : !this.ctx.sequence ? "Abra ou selecione uma sequência." : compatibility(this.selected, this.ctx.hostVersion) ?? (this.form && !this.form.valid() ? "Corrija os parâmetros destacados." : null);
    setDisabled(insertBtn, this.busy || !!why);
    insertBtn.title = why ?? "";
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
    this.stopVideo();
    clear($(this.root, "#detail"));
    this.showDetail(false);
    this.selected = null;
    this.form = null;
    this.opts = null;
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
    if (this.folder) {
      n.title = this.catalog.online ? `Biblioteca: ${this.folder.displayPath ?? ""}` : `Pasta indisponível — mostrando a última lista conhecida${this.catalog.lastSyncError ? ` (${this.catalog.lastSyncError.message})` : ""}`;
      return;
    }
    n.title = this.catalog.online ? "Online — catálogo sincronizado" : `Offline — usando biblioteca local${this.catalog.lastSyncError ? ` (${this.catalog.lastSyncError.message})` : ""}`;
  }
}

function previewElement(url: string, poster: string | null, kind: "video" | "audio" | "image"): HTMLElement {
  if (kind === "image") return h("img", { class: "preview", src: url, alt: "" });
  const fallback = () => h("div", { class: "preview-empty" }, "Este Premiere não reproduz preview no painel. Insira na sequência para ver.");
  if (kind === "audio") {
    const a = h("audio", { src: url, controls: true, autoplay: true });
    a.onerror = () => a.replaceWith(fallback());
    return h("div", { class: "preview-audio" }, poster ? h("img", { class: "preview", src: poster, alt: "" }) : null, a);
  }
  const v = h("video", { src: url, poster: poster ?? null, controls: true, loop: true, autoplay: true, class: "preview" });
  v.muted = true;
  v.onerror = () => v.replaceWith(fallback());
  return v;
}

/** Tipos de efeito pensados para repetir (fundos, texturas, overlays). */
const LOOPABLE = new Set<string>(["background", "texture", "overlay"]);

const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s * 10) / 10} s`);

/** "Grão de Filme (Vertical 9:16)" → "grão de filme". */
const baseName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();

/** Formato da sequência entre os suportados, ou null se for outro. */
export function aspectOf(w: number, h: number): "16:9" | "9:16" | "1:1" | "4:5" | null {
  if (!w || !h) return null;
  const r = w / h;
  const known: Array<["16:9" | "9:16" | "1:1" | "4:5", number]> = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5]];
  const best = known.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
  return Math.abs(best[1] - r) < 0.03 ? best[0] : null;
}

/** Encaixa a imagem na caixa mantendo a proporção (o UXP não tem object-fit). */
function fitImage(img: HTMLImageElement, maxH = 240): void {
  const w = img.naturalWidth, hgt = img.naturalHeight;
  const boxW = img.parentElement?.clientWidth ?? 0;
  if (!w || !hgt || !boxW) return;
  const scale = Math.min(boxW / w, maxH / hgt);
  img.style.width = `${Math.round(w * scale)}px`;
  img.style.height = `${Math.round(hgt * scale)}px`;
}
