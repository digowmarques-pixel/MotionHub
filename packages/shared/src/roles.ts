/** Perfis de usuário e permissões (Especificação §3). */
export const ROLES = ["editor", "motion_designer", "curator", "admin", "support"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "asset:read",
  "asset:apply",
  "favourite:write",
  "asset:create",
  "asset:edit_params",
  "asset:request_review",
  "asset:publish",
  "asset:deprecate",
  "user:manage",
  "team:manage",
  "audit:read",
  "diagnostics:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const EDITOR: Permission[] = ["asset:read", "asset:apply", "favourite:write"];
const DESIGNER: Permission[] = [...EDITOR, "asset:create", "asset:edit_params", "asset:request_review"];
const CURATOR: Permission[] = [...DESIGNER, "asset:publish", "asset:deprecate"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  editor: EDITOR,
  motion_designer: DESIGNER,
  curator: CURATOR,
  admin: [...CURATOR, "user:manage", "team:manage", "audit:read", "diagnostics:read"],
  support: ["asset:read", "diagnostics:read", "audit:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
