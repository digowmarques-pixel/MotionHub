const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export function parseSemver(v: string): SemVer | null {
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] };
}

export function isSemver(v: string): boolean {
  return parseSemver(v) !== null;
}

/** Retorna <0, 0, >0. Versões inválidas lançam erro. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Versão semver inválida: ${!pa ? a : b}`);
  for (const k of ["major", "minor", "patch"] as const) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k];
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * Compara versões de host Adobe ("25.6", "25.6.1", "26.0").
 * Não é semver estrito: segmentos ausentes valem 0.
 */
export function compareHostVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
