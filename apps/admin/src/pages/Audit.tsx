import { useState } from "react";
import { api } from "../api";
import { Notice, fmtDate, useAsync } from "../ui";

interface Entry {
  id: number;
  action: string;
  targetType: string;
  targetId: string | null;
  data: Record<string, unknown>;
  at: string;
  actor: string | null;
}

export function Audit() {
  const [action, setAction] = useState("");
  const { data, error } = useAsync(() => api<Entry[]>("GET", `/v1/admin/audit?limit=300${action ? `&action=${encodeURIComponent(action)}` : ""}`), [action]);
  return (
    <section>
      <header className="page-head">
        <h1>Auditoria</h1>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filtrar ação">
          <option value="">Todas as ações</option>
          <option value="asset.">Assets</option>
          <option value="pack.">Pacotes</option>
          <option value="user.">Usuários</option>
          <option value="auth.">Logins</option>
          <option value="device.">Estações</option>
        </select>
      </header>
      <Notice kind="error">{error}</Notice>
      <table>
        <thead>
          <tr>
            <th>Quando</th>
            <th>Quem</th>
            <th>Ação</th>
            <th>Alvo</th>
            <th>Detalhes</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((e) => (
            <tr key={e.id}>
              <td>{fmtDate(e.at)}</td>
              <td>{e.actor ?? "sistema"}</td>
              <td className="mono">{e.action}</td>
              <td>
                {e.targetType === "asset" && e.targetId ? <a href={`#/assets/${e.targetId}`}>asset</a> : e.targetType}
              </td>
              <td className="mono small">{Object.keys(e.data).length ? JSON.stringify(e.data) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
