/** Log local com rotação simples e mascaramento de caminhos pessoais (M15). */
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const MAX = 2 * 1024 * 1024;

export function maskPaths(s: string): string {
  return s
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/g, "$1<user>")
    .replace(/(\/Users\/)[^/\s"']+/g, "$1<user>")
    .replace(/(\/home\/)[^/\s"']+/g, "$1<user>");
}

export class Logger {
  constructor(private readonly file: string) {}

  async log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), level, msg: maskPaths(msg), ...(data ? { data: JSON.parse(maskPaths(JSON.stringify(data))) } : {}) });
    try {
      await mkdir(dirname(this.file), { recursive: true });
      const size = await stat(this.file).then((s) => s.size, () => 0);
      if (size > MAX) await rename(this.file, `${this.file}.1`);
      await appendFile(this.file, line + "\n");
    } catch {
      /* log nunca derruba a aplicação */
    }
  }

  async tail(lines = 500): Promise<string[]> {
    const t = await readFile(this.file, "utf8").catch(() => "");
    return t.trim().split("\n").filter(Boolean).slice(-lines);
  }
}
