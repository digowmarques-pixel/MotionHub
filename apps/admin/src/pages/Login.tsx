import { useState, type FormEvent } from "react";
import type { UserDTO } from "@motionhub/shared";
import { baseUrl, login } from "../api";
import { Notice } from "../ui";

export function Login({ onLogin }: { onLogin: (u: UserDTO) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      onLogin(await login(String(f.get("server")), String(f.get("email")), String(f.get("password"))));
    } catch (ex) {
      setError(ex instanceof TypeError ? "Não foi possível conectar ao servidor." : (ex as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="login card" onSubmit={submit}>
      <div className="brand">
        <span className="logo">M</span>
        <div>
          <strong>Motion Hub</strong>
          <small>Administração · Megalume</small>
        </div>
      </div>
      <label>
        Servidor
        <input name="server" type="url" required defaultValue={baseUrl()} />
      </label>
      <label>
        E-mail
        <input name="email" type="email" required autoComplete="username" autoFocus />
      </label>
      <label>
        Senha
        <input name="password" type="password" required autoComplete="current-password" />
      </label>
      <Notice kind="error">{error}</Notice>
      <button className="primary" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
