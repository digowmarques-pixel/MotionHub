import { useState } from "react";
import { ROLES, type Role, type UserDTO } from "@motionhub/shared";
import { api } from "../api";
import { Badge, Notice, errorText, fmtDate, useAsync } from "../ui";

const ROLE_LABEL: Record<Role, string> = {
  editor: "Editor",
  motion_designer: "Motion Designer",
  curator: "Curador",
  admin: "Administrador",
  support: "TI/Suporte",
};

export function Users({ me }: { me: UserDTO }) {
  const users = useAsync(() => api<UserDTO[]>("GET", "/v1/admin/users"), []);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const patch = async (u: UserDTO, body: Record<string, unknown>, ok: string) => {
    try {
      await api("PATCH", `/v1/admin/users/${u.id}`, body);
      setMsg({ kind: "ok", text: ok });
      await users.reload();
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    }
  };

  return (
    <section>
      <header className="page-head">
        <h1>Usuários</h1>
      </header>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <form
        className="form card inline"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          try {
            await api("POST", "/v1/admin/users", Object.fromEntries(f));
            setMsg({ kind: "ok", text: "Usuário criado." });
            form.reset();
            await users.reload();
          } catch (ex) {
            setMsg({ kind: "error", text: errorText(ex) });
          }
        }}
      >
        <input name="name" placeholder="Nome" required />
        <input name="email" type="email" placeholder="E-mail" required />
        <select name="role" defaultValue="editor">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <input name="password" type="password" placeholder="Senha inicial (mín. 12)" minLength={12} required autoComplete="new-password" />
        <button className="primary">Adicionar</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Perfil</th>
            <th>Estado</th>
            <th>Desde</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u, { role: e.target.value }, "Perfil alterado; sessões do usuário foram encerradas.")} aria-label={`Perfil de ${u.name}`}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <Badge state={u.status === "active" ? "ready" : "revoked"} /> {u.status === "active" ? "ativo" : "desativado"}
              </td>
              <td>{fmtDate(u.createdAt)}</td>
              <td>
                {u.id !== me.id ? (
                  <button className="small" onClick={() => patch(u, { status: u.status === "active" ? "disabled" : "active" }, u.status === "active" ? "Usuário desativado e sessões revogadas." : "Usuário reativado.")}>
                    {u.status === "active" ? "Desativar" : "Reativar"}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
