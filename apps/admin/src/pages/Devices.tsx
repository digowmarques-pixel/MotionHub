import { api } from "../api";
import { Notice, fmtDate, useAsync } from "../ui";

interface Device {
  id: string;
  name: string;
  os: string;
  app_version: string | null;
  host_versions: Record<string, string>;
  last_seen: string;
  revoked_at: string | null;
  user_name: string | null;
  installs: Array<{ pack: string; version: string; status: string }>;
}

export function Devices() {
  const { data, error, reload } = useAsync(() => api<Device[]>("GET", "/v1/admin/devices"), []);
  return (
    <section>
      <header className="page-head">
        <h1>Estações</h1>
      </header>
      <Notice kind="error">{error}</Notice>
      {data && !data.length ? <p className="muted">Nenhuma estação registrada ainda. Elas aparecem quando o Gerenciador desktop envia o primeiro heartbeat.</p> : null}
      <table>
        <thead>
          <tr>
            <th>Estação</th>
            <th>Usuário</th>
            <th>Sistema</th>
            <th>Adobe</th>
            <th>Pacotes</th>
            <th>Último contato</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.map((d) => (
            <tr key={d.id} className={d.revoked_at ? "muted" : ""}>
              <td>{d.name}</td>
              <td>{d.user_name ?? "—"}</td>
              <td>{d.os}</td>
              <td className="small">{Object.entries(d.host_versions).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}</td>
              <td className="small">{d.installs.map((i) => `${i.pack}@${i.version}${i.status !== "installed" ? ` (${i.status})` : ""}`).join(", ") || "—"}</td>
              <td>{fmtDate(d.last_seen)}</td>
              <td>
                {!d.revoked_at ? (
                  <button className="danger small" onClick={async () => { if (confirm(`Revogar acesso da estação "${d.name}"?`)) { await api("POST", `/v1/admin/devices/${d.id}/revoke`); await reload(); } }}>
                    Revogar
                  </button>
                ) : (
                  "revogada"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
