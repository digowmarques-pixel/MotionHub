import { useEffect, useState } from "react";
import { can, type UserDTO } from "@motionhub/shared";
import { currentUser, logout } from "./api";
import { Login } from "./pages/Login";
import { Assets } from "./pages/Assets";
import { AssetDetail } from "./pages/AssetDetail";
import { NewAsset } from "./pages/NewAsset";
import { Packs } from "./pages/Packs";
import { Users } from "./pages/Users";
import { Audit } from "./pages/Audit";
import { Devices } from "./pages/Devices";

/** Roteamento por hash: #/assets, #/assets/<id>, #/new, #/packs, #/users, #/audit, #/devices */
function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

export function App() {
  const [user, setUser] = useState<UserDTO | null>(currentUser());
  const route = useRoute();
  if (!user) return <Login onLogin={setUser} />;

  const nav: Array<[string, string, boolean]> = [
    ["assets", "Catálogo", true],
    ["new", "Novo asset", can(user.role, "asset:create")],
    ["packs", "Pacotes", can(user.role, "asset:publish")],
    ["users", "Usuários", can(user.role, "user:manage")],
    ["devices", "Estações", can(user.role, "diagnostics:read")],
    ["audit", "Auditoria", can(user.role, "audit:read")],
  ];
  const page = route[0] ?? "assets";

  return (
    <div className="layout">
      <aside>
        <div className="brand">
          <span className="logo">M</span>
          <div>
            <strong>Motion Hub</strong>
            <small>Administração</small>
          </div>
        </div>
        <nav>
          {nav
            .filter(([, , ok]) => ok)
            .map(([k, label]) => (
              <a key={k} href={`#/${k}`} className={page === k ? "active" : ""}>
                {label}
              </a>
            ))}
        </nav>
        <div className="me">
          <div>{user.name}</div>
          <small>{user.role}</small>
          <button
            className="link"
            onClick={async () => {
              await logout();
              setUser(null);
            }}
          >
            Sair
          </button>
        </div>
      </aside>
      <main>
        {page === "assets" && route[1] ? <AssetDetail id={route[1]} user={user} /> : null}
        {page === "assets" && !route[1] ? <Assets /> : null}
        {page === "new" ? <NewAsset /> : null}
        {page === "packs" ? <Packs /> : null}
        {page === "users" ? <Users me={user} /> : null}
        {page === "devices" ? <Devices /> : null}
        {page === "audit" ? <Audit /> : null}
      </main>
    </div>
  );
}
