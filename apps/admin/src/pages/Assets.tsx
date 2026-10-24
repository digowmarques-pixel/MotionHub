import { useState } from "react";
import type { AssetDTO, AssetState, Page } from "@motionhub/shared";
import { api } from "../api";
import { Badge, Notice, fmtDate, useAsync } from "../ui";

const TABS: Array<[AssetState | "", string]> = [
  ["", "Todos"],
  ["review", "Em revisão"],
  ["draft", "Rascunhos"],
  ["published", "Publicados"],
  ["deprecated", "Descontinuados"],
];

export function Assets() {
  const [state, setState] = useState<AssetState | "">("review");
  const [query, setQuery] = useState("");
  const { data, error, loading } = useAsync(() => {
    const q = new URLSearchParams({ limit: "200", sort: "updated" });
    if (state) q.set("state", state);
    if (query) q.set("query", query);
    return api<Page<AssetDTO>>("GET", `/v1/assets?${q}`);
  }, [state, query]);

  return (
    <section>
      <header className="page-head">
        <h1>Catálogo</h1>
        <input type="search" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar" />
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={state === k} className={state === k ? "active" : ""} onClick={() => setState(k)}>
            {label}
          </button>
        ))}
      </div>
      <Notice kind="error">{error}</Notice>
      {loading && !data ? <p className="muted">Carregando…</p> : null}
      {data && !data.items.length ? <p className="muted empty">Nenhum asset neste filtro.</p> : null}
      <div className="asset-grid">
        {data?.items.map((a) => (
          <a key={a.id} href={`#/assets/${a.id}`} className="asset-card">
            <div className="thumb">{a.posterUrl ? <img src={a.posterUrl} alt="" loading="lazy" /> : <span className="muted">sem preview</span>}</div>
            <div className="asset-meta">
              <strong>{a.name}</strong>
              <div className="row">
                <Badge state={a.state} />
                <span className="muted">{a.latestVersion ? `v${a.latestVersion}` : "sem versão publicada"}</span>
              </div>
              <small className="muted">
                {a.type} · atualizado {fmtDate(a.updatedAt)}
              </small>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
