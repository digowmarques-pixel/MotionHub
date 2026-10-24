/** Detecta instalações do Premiere Pro e After Effects (M11) pelos caminhos padrão da Adobe. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface HostInstall {
  host: "premiere" | "after-effects";
  version: string;
  path: string;
}

const PATTERNS: Array<[HostInstall["host"], RegExp]> = [
  ["premiere", /^Adobe Premiere Pro (\d{4}|\(Beta\))/i],
  ["after-effects", /^Adobe After Effects (\d{4}|\(Beta\))/i],
];

export async function detectHosts(platform = process.platform): Promise<HostInstall[]> {
  const roots = platform === "darwin" ? ["/Applications"] : platform === "win32" ? [join(process.env.ProgramFiles ?? "C:\\Program Files", "Adobe")] : [];
  const out: HostInstall[] = [];
  for (const root of roots) {
    const names = await readdir(root).catch(() => [] as string[]);
    for (const name of names) {
      for (const [host, re] of PATTERNS) {
        const m = re.exec(name);
        if (!m) continue;
        const path = join(root, name);
        out.push({ host, path, version: (await readVersion(path, platform)) ?? m[1]! });
      }
    }
  }
  return out;
}

/** macOS: CFBundleShortVersionString do Info.plist; Windows: ano da pasta (versão exata exige leitura do .exe). */
async function readVersion(dir: string, platform: string): Promise<string | null> {
  if (platform !== "darwin") return null;
  for (const app of await readdir(dir).catch(() => [] as string[])) {
    if (!app.endsWith(".app")) continue;
    const plist = await readFile(join(dir, app, "Contents", "Info.plist"), "utf8").catch(() => "");
    const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
    if (m) return m[1]!;
  }
  return null;
}
