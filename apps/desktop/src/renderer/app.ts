/** Interface do Gerenciador (sem acesso a Node: fala apenas com window.motionhub). */
import type { ListResult, MotionHubBridge, PackRow, Settings } from "../core/bridge.js";
import type { InstallProgress } from "../core/types.js";

declare global {
  interface Window {
    motionhub: MotionHubBridge;
  }
}

const mh = window.motionhub;
type Host = "premiere" | "after-effects";

const SECTION: Record<string, string> = {
  title: "Títulos e Tipografia",
  text: "Títulos e Tipografia",
  timer: "Títulos e Tipografia",
  transition: "Transições",
  shape: "Componentes Gráficos",
  overlay: "Componentes Gráficos",
  media: "Componentes Gráficos",
  caption: "Legendas",
  sfx: "Sons",
};
const SECTION_ORDER = ["Títulos e Tipografia", "Transições", "Componentes Gráficos", "Legendas", "Sons", "Outros"];
const STAGE: Record<InstallProgress["stage"], string> = {
  manifest: "Lendo manifest…",
  download: "Baixando",
  verify: "Verificando integridade…",
  extract: "Extraindo e conferindo arquivos",
  activate: "Ativando…",
  done: "Concluído",
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Array<Node | string | null | false | undefined>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

/** Barra de progresso via CSSOM: a CSP proíbe atributos style inline. */
function fill(pct: number): HTMLElement {
  const i = document.createElement("i");
  i.style.width = `${pct}%`;
  return i;
}

const fmtBytes = (n: number | null) => (!n ? "" : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

class ManagerApp {
  private host: Host = "premiere";
  private data: ListResult = { online: true, error: null, packs: [] };
  private progress = new Map<string, InstallProgress & { error?: string }>();
  private root = document.getElementById("app")!;

  async start(): Promise<void> {
    mh.onProgress((p) => {
      this.progress.set(p.slug, p);
      if (p.stage === "done") setTimeout(() => this.progress.delete(p.slug), p.error ? 8000 : 0);
      if (p.error) this.toast(`Falha em ${p.slug}: ${p.error}`, "error");
      this.renderList();
    });
    mh.onChanged(() => void this.refresh());
    const s = await mh.session();
    if (s.user) {
      this.renderShell(s.user.email);
      await this.refresh();
    } else this.renderLogin(s.server);
  }

  private renderLogin(server: string | null, error?: string): void {
    this.root.replaceChildren(
      h("form", { class: "login", onsubmit: async (e: Event) => {
          e.preventDefault();
          const f = new FormData(e.target as HTMLFormElement);
          const btn = (e.target as HTMLFormElement).querySelector("button")!;
          btn.disabled = true;
          try {
            const u = await mh.login(String(f.get("server")), String(f.get("email")), String(f.get("password")));
            this.renderShell(u.email);
            await this.refresh();
          } catch (ex) {
            this.renderLogin(String(f.get("server")), cleanError(ex));
          }
        } },
        h("div", { class: "brand" }, h("span", { class: "logo" }, "M"), h("div", {}, h("strong", {}, "Motion Hub"), h("small", {}, "Gerenciador de pacotes · Megalume"))),
        h("label", {}, "Servidor", h("input", { name: "server", type: "url", required: true, value: server ?? "", placeholder: "https://motionhub.megalume.com.br" })),
        h("label", {}, "E-mail", h("input", { name: "email", type: "email", required: true, autocomplete: "username" })),
        h("label", {}, "Senha", h("input", { name: "password", type: "password", required: true, autocomplete: "current-password" })),
        error ? h("div", { class: "error", role: "alert" }, error) : null,
        h("button", { class: "primary" }, "Entrar"),
      ),
    );
  }

  private renderShell(email: string): void {
    const tab = (host: Host, label: string) =>
      h("button", { class: `tab${this.host === host ? " active" : ""}`, "data-host": host, onclick: () => { this.host = host; this.root.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", (t as HTMLElement).dataset.host === host)); this.renderList(); } }, label);
    this.root.replaceChildren(
      h("header", { class: "top" },
        tab("after-effects", "After Effects"),
        tab("premiere", "Premiere Pro"),
        h("span", { class: "spacer" }),
        h("span", { id: "net", class: "net" }),
        h("span", { class: "email" }, email),
        h("button", { class: "icon", title: "Configurações", "aria-label": "Configurações", onclick: () => void this.openSettings() }, "⚙"),
      ),
      h("main", { id: "list", class: "list" }),
      h("footer", { class: "bottom" },
        h("button", { class: "pill", onclick: () => void this.refresh() }, "Atualizar lista"),
        h("span", { class: "spacer" }),
        h("button", { class: "pill solid", id: "install-all", onclick: () => void this.installAll() }, "Instalar tudo"),
      ),
      h("div", { id: "toast", class: "toast", role: "status", hidden: true }),
      h("section", { id: "settings", class: "settings", hidden: true }),
    );
  }

  private async refresh(): Promise<void> {
    this.data = await mh.list();
    if (this.data.error && /login|sessão|autentica/i.test(this.data.error) && this.data.online) {
      const s = await mh.session();
      if (!s.user) return this.renderLogin(s.server, "Sua sessão expirou. Entre novamente.");
    }
    const net = this.root.querySelector("#net");
    if (net) {
      net.className = `net ${this.data.online ? "on" : "off"}`;
      net.textContent = this.data.online ? "online" : "offline: mostrando só o que está instalado";
    }
    this.renderList();
  }

  private renderList(): void {
    const list = this.root.querySelector("#list");
    if (!list) return;
    const packs = this.data.packs.filter((p) => !p.hosts?.length || p.hosts.includes(this.host));
    const groups = new Map<string, PackRow[]>();
    for (const p of packs) {
      const sec = SECTION[p.types?.[0] ?? ""] ?? "Outros";
      groups.set(sec, [...(groups.get(sec) ?? []), p]);
    }
    const out: Node[] = [];
    if (!packs.length) {
      out.push(h("div", { class: "empty" },
        h("strong", {}, this.host === "after-effects" ? "Nenhum pacote para After Effects ainda" : "Nenhum pacote publicado"),
        h("p", {}, this.data.error ? `Não foi possível falar com o servidor: ${this.data.error}` : "Quando um curador publicar um pacote, ele aparece aqui."),
      ));
    }
    for (const sec of SECTION_ORDER) {
      const items = groups.get(sec);
      if (!items?.length) continue;
      out.push(h("h2", { class: "section" }, sec));
      for (const p of items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))) out.push(this.row(p));
    }
    list.replaceChildren(...out);
    const todo = this.data.packs.filter((p) => p.status === "ready" && !p.revoked && p.installedVersion !== p.version && !p.orphan);
    const all = this.root.querySelector<HTMLButtonElement>("#install-all");
    if (all) {
      all.disabled = !todo.length || !this.data.online;
      all.textContent = todo.length ? `Instalar tudo (${todo.length})` : "Tudo instalado";
    }
  }

  private row(p: PackRow): HTMLElement {
    const prog = this.progress.get(p.slug);
    const update = p.installedVersion && p.installedVersion !== p.version && !p.orphan;
    const meta = [p.assetCount ? `${p.assetCount} ${p.assetCount === 1 ? "item" : "itens"}` : "", fmtBytes(p.archiveBytes), `v${p.version}`].filter(Boolean).join(" · ");
    let status: Node | null = null;
    if (p.revoked) status = h("span", { class: "status bad" }, "Revogado pelo administrador. Não use em projetos novos.");
    else if (update) status = h("span", { class: "status warn" }, `Atualização disponível: v${p.installedVersion} → v${p.version}`);
    else if (p.installedVersion) status = h("span", { class: "status ok" }, `Instalado · v${p.installedVersion}`);

    let action: Node;
    if (prog && prog.stage !== "done") {
      const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
      action = h("div", { class: "progress" },
        h("div", { class: "bar" }, fill(prog.stage === "download" || prog.stage === "extract" ? pct : 100)),
        h("small", {}, `${STAGE[prog.stage]}${prog.stage === "download" ? ` ${pct}%` : ""}`),
        h("button", { class: "link", onclick: () => void mh.cancel(p.slug) }, "Cancelar"),
      );
    } else {
      const label = p.revoked ? "Revogado" : update ? "Atualizar" : p.installedVersion ? "Instalado" : "Instalar";
      const main = h("button", { class: "pill main", disabled: p.revoked || (!!p.installedVersion && !update) || p.orphan || !this.data.online, onclick: () => void this.install(p) }, label);
      const menu = h("details", { class: "menu" }, h("summary", { class: "pill caret", "aria-label": "Mais opções" }, "▾"),
        h("div", { class: "menu-items" },
          p.installedVersion && p.previousVersion ? h("button", { onclick: () => void this.rollback(p) }, `Voltar para v${p.previousVersion}`) : null,
          p.installedVersion ? h("button", { onclick: () => void this.uninstall(p) }, "Remover") : null,
          !p.installedVersion ? h("span", { class: "muted" }, "Sem outras ações") : null,
        ));
      action = h("div", { class: "split-btn" }, main, menu);
    }

    return h("div", { class: `row${p.revoked ? " revoked" : ""}` },
      h("div", { class: "thumb" }, p.posterUrl ? h("img", { src: p.posterUrl, alt: "", loading: "lazy" }) : h("span", {}, (p.types?.[0] ?? "pack").slice(0, 3).toUpperCase())),
      h("div", { class: "info" }, h("div", { class: "name" }, p.name), h("div", { class: "meta" }, meta), status),
      action,
    );
  }

  private async install(p: PackRow): Promise<void> {
    this.progress.set(p.slug, { slug: p.slug, stage: "manifest", done: 0, total: 1 });
    this.renderList();
    try {
      await mh.install(p.id);
      this.toast(`${p.name} v${p.version} instalado.`, "ok");
    } catch {
      /* erro já reportado via progresso */
    }
    await this.refresh();
  }

  private async installAll(): Promise<void> {
    const r = await mh.installAll();
    this.toast(r.failed ? `${r.installed} instalados, ${r.failed} com falha.` : `${r.installed} pacotes instalados.`, r.failed ? "error" : "ok");
    await this.refresh();
  }

  private async rollback(p: PackRow): Promise<void> {
    try {
      const v = await mh.rollback(p.slug);
      this.toast(`${p.name} voltou para v${v}.`, "ok");
    } catch (e) {
      this.toast(cleanError(e), "error");
    }
  }

  private async uninstall(p: PackRow): Promise<void> {
    if (!confirm(`Remover "${p.name}" da biblioteca?\n\nOs arquivos continuam no disco para não quebrar projetos que já os usam. Para liberar espaço, use "Limpar versões antigas" nas configurações.`)) return;
    await mh.uninstall(p.slug);
    this.toast(`${p.name} removido.`, "ok");
  }

  private async openSettings(): Promise<void> {
    const s = await mh.settings();
    const panel = this.root.querySelector<HTMLElement>("#settings")!;
    const close = () => (panel.hidden = true);
    const render = (st: Settings) => {
      const consent = h("input", { type: "checkbox", id: "consent" }) as HTMLInputElement;
      panel.replaceChildren(
        h("div", { class: "settings-card" },
          h("header", {}, h("h2", {}, "Configurações"), h("button", { class: "icon", "aria-label": "Fechar", onclick: close }, "✕")),
          h("h3", {}, "Pasta da biblioteca"),
          h("code", { class: "path" }, st.libraryDir),
          h("div", { class: "actions" },
            h("button", { class: "pill", onclick: async () => { const n = await mh.chooseLibraryDir(); if (n) { render(n); this.toast("Biblioteca copiada para a nova pasta.", "ok"); } } }, "Mudar pasta…"),
            h("button", { class: "pill", onclick: () => void mh.openLibraryFolder() }, "Abrir pasta"),
            h("button", { class: "pill", onclick: async () => { if (!confirm("Apagar do disco versões que não são a atual nem a anterior? Projetos antigos que usem essas versões precisarão de nova versão do asset.")) return; const n = await mh.purgeOldVersions(); this.toast(`Liberados ${fmtBytes(n) || "0 KB"}.`, "ok"); } }, "Limpar versões antigas"),
          ),
          h("h3", {}, "Aplicativos Adobe detectados"),
          st.hosts.length
            ? h("ul", {}, ...st.hosts.map((x) => h("li", {}, `${x.host === "premiere" ? "Premiere Pro" : "After Effects"} ${x.version}`)))
            : h("p", { class: "muted" }, "Nenhum encontrado nos caminhos padrão da Adobe."),
          h("h3", {}, "Segurança"),
          h("p", { class: "muted" }, st.trustedKeyId ? `Chave de assinatura confiável: ${st.trustedKeyId}. Pacotes assinados com outra chave são recusados.` : "A chave de assinatura será registrada no primeiro acesso ao servidor."),
          h("h3", {}, "Diagnóstico"),
          h("p", { class: "muted" }, "Inclui versões, pacotes instalados e o log recente, com caminhos pessoais mascarados. Nenhuma mídia ou projeto é enviado."),
          h("div", { class: "actions" },
            h("button", { class: "pill", onclick: async () => { const f = await mh.exportDiagnostics(); if (f) this.toast("Diagnóstico salvo.", "ok"); } }, "Exportar para arquivo"),
            h("label", { class: "check" }, consent, " Autorizo enviar ao suporte"),
            h("button", { class: "pill", onclick: async () => { if (!consent.checked) return this.toast("Marque a autorização antes de enviar.", "error"); try { const id = await mh.sendDiagnostics(true); this.toast(`Enviado. Protocolo ${id.slice(0, 8)}.`, "ok"); } catch (e) { this.toast(cleanError(e), "error"); } } }, "Enviar"),
          ),
          h("footer", {}, h("span", { class: "muted" }, `Versão ${st.appVersion}${st.deviceId ? ` · estação ${st.deviceId.slice(0, 8)}` : ""}`),
            h("button", { class: "pill", onclick: async () => { await mh.logout(); const ss = await mh.session(); this.renderLogin(ss.server); } }, "Sair")),
        ),
      );
    };
    render(s);
    panel.hidden = false;
  }

  private toast(msg: string, kind: "ok" | "error"): void {
    const t = this.root.querySelector<HTMLElement>("#toast");
    if (!t) return;
    t.textContent = msg;
    t.className = `toast ${kind}`;
    t.hidden = false;
    clearTimeout((t as unknown as { _t?: number })._t);
    (t as unknown as { _t?: number })._t = window.setTimeout(() => (t.hidden = true), 5000);
  }
}

/** Remove o prefixo técnico que o Electron adiciona a erros de IPC. */
function cleanError(e: unknown): string {
  return String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

void new ManagerApp().start();
