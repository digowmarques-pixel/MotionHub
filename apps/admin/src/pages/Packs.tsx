import { useEffect, useState } from "react";
import type { AssetDTO, Page } from "@motionhub/shared";
import { api } from "../api";
import { Badge, Notice, errorText, fmtBytes, fmtDate, useAsync } from "../ui";

interface PackDTO {
  id: string;
  slug: string;
  name: string;
  version: string;
  status: string;
  archiveSha256: string | null;
  archiveBytes: number | null;
  createdAt: string;
}

export function Packs() {
  const packs = useAsync(() => api<PackDTO[]>("GET", "/v1/admin/packs"), []);
  const assets = useAsync(() => api<Page<AssetDTO>>("GET", "/v1/assets?state=published&limit=200&sort=name"), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const building = packs.data?.some((p) => p.status === "building");
  const reloadPacks = packs.reload;
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => void reloadPacks(), 2500);
    return () => clearInterval(t);
  }, [building, reloadPacks]);

  return (
    <section>
      <header className="page-head">
        <h1>Pacotes (.mlpack)</h1>
      </header>
      <p className="muted">
        Um pacote agrupa versões publicadas para instalação em várias estações. O arquivo é assinado (Ed25519) e cada arquivo tem hash verificado antes da instalação.
      </p>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <div className="split">
        <form
          className="form card"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const items = assets.data!.items.filter((a) => selected.has(a.id)).map((a) => ({ assetId: a.id, semver: a.latestVersion! }));
            if (!items.length) return setMsg({ kind: "error", text: "Selecione ao menos um asset." });
            try {
              await api("POST", "/v1/admin/packs", { slug: f.get("slug"), name: f.get("name"), version: f.get("version"), license: f.get("license"), items });
              setMsg({ kind: "ok", text: "Pacote em geração." });
              setSelected(new Set());
              await packs.reload();
            } catch (ex) {
              setMsg({ kind: "error", text: errorText(ex) });
            }
          }}
        >
          <h2>Novo pacote</h2>
          <div className="cols">
            <label>
              Nome <input name="name" required />
            </label>
            <label>
              ID (slug) <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{2,63}" />
            </label>
            <label>
              Versão <input name="version" required defaultValue="1.0.0" />
            </label>
          </div>
          <label>
            Licença <input name="license" required defaultValue="megalume-internal" />
          </label>
          <fieldset className="picker">
            <legend>Assets publicados ({selected.size} selecionados)</legend>
            {assets.data?.items.map((a) => (
              <label key={a.id} className="check">
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={(e) => {
                    const s = new Set(selected);
                    if (e.target.checked) s.add(a.id);
                    else s.delete(a.id);
                    setSelected(s);
                  }}
                />
                {a.name} <span className="muted">v{a.latestVersion}</span>
              </label>
            ))}
          </fieldset>
          <button className="primary">Gerar pacote</button>
        </form>
        <div>
          <table>
            <thead>
              <tr>
                <th>Pacote</th>
                <th>Versão</th>
                <th>Estado</th>
                <th>Tamanho</th>
                <th>Criado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {packs.data?.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <br />
                    <small className="muted mono">{p.slug}</small>
                  </td>
                  <td>{p.version}</td>
                  <td>
                    <Badge state={p.status} />
                  </td>
                  <td>{p.archiveBytes ? fmtBytes(p.archiveBytes) : "—"}</td>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>
                    {p.status === "ready" ? (
                      <button
                        className="danger small"
                        onClick={async () => {
                          const reason = prompt("Motivo da revogação (kill-switch: estações deixam de instalar este pacote):");
                          if (!reason) return;
                          try {
                            await api("POST", `/v1/admin/packs/${p.id}/revoke`, { reason });
                            await packs.reload();
                          } catch (ex) {
                            setMsg({ kind: "error", text: errorText(ex) });
                          }
                        }}
                      >
                        Revogar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
