import { useEffect, useState } from "react";
import { can, type AssetDTO, type AssetVersionDTO, type UserDTO } from "@motionhub/shared";
import { api } from "../api";
import { Badge, Notice, errorText, fmtBytes, fmtDate, useAsync } from "../ui";

interface JobRow {
  id: string;
  kind: string;
  status: string;
  progress: number;
  retries: number;
  error_code: string | null;
  error_detail: string | null;
  updated_at: string;
  semver: string;
}

interface Detail {
  asset: AssetDTO;
  versions: AssetVersionDTO[];
  jobs: JobRow[];
}

export function AssetDetail({ id, user }: { id: string; user: UserDTO }) {
  const { data, error, reload } = useAsync(() => api<Detail>("GET", `/v1/admin/assets/${id}`), [id]);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Atualiza enquanto houver job de preview em andamento.
  const pending = data?.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void reload(), 2500);
    return () => clearInterval(t);
  }, [pending, reload]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: label });
      await reload();
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="muted">Carregando…</p>;
  const { asset: a, versions, jobs } = data;
  const canPublish = can(user.role, "asset:publish");

  return (
    <section>
      <header className="page-head">
        <div>
          <a href="#/assets" className="muted">
            ← Catálogo
          </a>
          <h1>{a.name}</h1>
          <div className="row">
            <Badge state={a.state} />
            <span className="muted">
              {a.slug} · {a.type} · {a.aspectRatio} · versão corrente: {a.latestVersion ?? "—"}
            </span>
          </div>
        </div>
        <div className="row">
          {a.state === "published" && can(user.role, "asset:deprecate") ? (
            <button disabled={busy} onClick={() => act("Asset descontinuado. Continua disponível para projetos existentes.", () => api("POST", `/v1/admin/assets/${id}/deprecate`))}>
              Descontinuar
            </button>
          ) : null}
          {a.state === "deprecated" && can(user.role, "asset:deprecate") ? (
            <button disabled={busy} onClick={() => act("Asset restaurado.", () => api("POST", `/v1/admin/assets/${id}/restore`))}>
              Restaurar
            </button>
          ) : null}
          {can(user.role, "team:manage") ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() => confirm(`Excluir "${a.name}" do catálogo? (exclusão lógica; arquivos e auditoria são mantidos)`) && act("Excluído.", async () => { await api("DELETE", `/v1/admin/assets/${id}`); location.hash = "#/assets"; })}
            >
              Excluir
            </button>
          ) : null}
        </div>
      </header>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}

      <div className="split">
        <div className="card">
          {a.previewUrl?.includes(".mp4") ? (
            <video src={a.previewUrl} poster={a.posterUrl ?? undefined} controls loop muted autoPlay className="preview" />
          ) : a.previewUrl ? (
            <div>
              {a.posterUrl ? <img src={a.posterUrl} alt="" className="preview" /> : null}
              <audio src={a.previewUrl} controls />
            </div>
          ) : (
            <p className="muted">O preview aparece aqui após a publicação.</p>
          )}
          {a.summary ? <p>{a.summary}</p> : null}
          <div className="tags">
            {a.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
          {can(user.role, "asset:edit_params") ? <MetaEditor asset={a} onSaved={reload} /> : null}
        </div>

        <div>
          <h2>Versões</h2>
          {versions.map((v) => {
            const generated = v.files.filter((f) => f.path.startsWith("_generated/"));
            const previewReady = generated.some((f) => f.role === "preview") && generated.some((f) => f.role === "poster");
            const job = jobs.find((j) => j.semver === v.semver);
            return (
              <div key={v.id} className="card version">
                <div className="row between">
                  <strong>v{v.semver}</strong>
                  <Badge state={v.status} />
                </div>
                <small className="muted">
                  {v.releaseDate ? `Publicada em ${fmtDate(v.releaseDate)}` : "Não publicada"} · hosts: {v.hostTargets.map((h) => `${h.name} ≥ ${h.minVersion}`).join(", ")}
                </small>
                {v.changelog ? <p className="small">{v.changelog}</p> : null}
                <details>
                  <summary>{v.files.length} arquivos</summary>
                  <ul className="files">
                    {v.files.map((f) => (
                      <li key={f.id}>
                        <code>{f.path}</code> · {f.role} · {fmtBytes(f.bytes)} · <span className="mono muted">{f.sha256.slice(0, 12)}…</span>
                      </li>
                    ))}
                  </ul>
                </details>
                {job ? (
                  <div className="small">
                    Preview: <Badge state={job.status} /> {job.status === "running" ? `${Math.round(job.progress * 100)}%` : null}
                    {job.error_detail ? <span className="error-text"> {job.error_detail}</span> : null}
                  </div>
                ) : null}
                <div className="row">
                  {v.status === "draft" && can(user.role, "asset:request_review") ? (
                    <button disabled={busy} onClick={() => act("Enviado para revisão. O preview padronizado está sendo gerado.", () => api("POST", `/v1/admin/assets/${id}/versions/${v.semver}/submit`))}>
                      Enviar para revisão
                    </button>
                  ) : null}
                  {v.status === "validated" && canPublish ? (
                    <>
                      <button
                        className="primary"
                        disabled={busy || !previewReady}
                        title={previewReady ? "" : "Aguardando preview padronizado"}
                        onClick={() => act(`Versão ${v.semver} publicada.`, () => api("POST", `/v1/admin/assets/${id}/publish`, { semver: v.semver }))}
                      >
                        Publicar
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const reason = prompt("Motivo da devolução (o designer verá no histórico):");
                          if (reason) void act("Devolvido para rascunho.", () => api("POST", `/v1/admin/assets/${id}/versions/${v.semver}/reject`, { reason }));
                        }}
                      >
                        Devolver
                      </button>
                    </>
                  ) : null}
                  {v.status === "published" && v.semver !== a.latestVersion && canPublish ? (
                    <button disabled={busy} onClick={() => act(`Versão corrente agora é ${v.semver}.`, () => api("POST", `/v1/admin/assets/${id}/rollback`, { semver: v.semver }))}>
                      Voltar para esta versão
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MetaEditor({ asset, onSaved }: { asset: AssetDTO; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open)
    return (
      <button className="link" onClick={() => setOpen(true)}>
        Editar metadados
      </button>
    );
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const list = (k: string) => String(f.get(k)).split(",").map((s) => s.trim()).filter(Boolean);
        try {
          await api("PATCH", `/v1/admin/assets/${asset.id}`, {
            name: String(f.get("name")),
            summary: String(f.get("summary")) || null,
            tags: list("tags"),
            synonyms: list("synonyms"),
            client: String(f.get("client")) || null,
            category: String(f.get("category")) || null,
          });
          setOpen(false);
          await onSaved();
        } catch (ex) {
          setErr(errorText(ex));
        }
      }}
    >
      <label>
        Nome <input name="name" defaultValue={asset.name} required />
      </label>
      <label>
        Resumo <textarea name="summary" defaultValue={asset.summary ?? ""} rows={2} />
      </label>
      <label>
        Tags <input name="tags" defaultValue={asset.tags.join(", ")} />
      </label>
      <label>
        Sinônimos <input name="synonyms" defaultValue={asset.synonyms.join(", ")} />
      </label>
      <div className="cols">
        <label>
          Cliente <input name="client" defaultValue={asset.client ?? ""} />
        </label>
        <label>
          Categoria <input name="category" defaultValue={asset.category ?? ""} />
        </label>
      </div>
      <Notice kind="error">{err}</Notice>
      <div className="row">
        <button className="primary">Salvar</button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
