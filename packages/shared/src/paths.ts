/**
 * Validação de caminhos dentro de pacotes (Especificação §9, M10):
 * recusa path traversal, caminhos absolutos, drive letters e nomes reservados.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 260) return false;
  if (p.includes("\0")) return false;
  if (p.includes("\\")) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") return false;
    if (WINDOWS_RESERVED.test(part)) return false;
    if (/[<>:"|?*\x00-\x1f]/.test(part)) return false;
    if (part.endsWith(" ") || part.endsWith(".")) return false;
  }
  return true;
}
