/**
 * Abstração da plataforma (UXP no Premiere; mock no navegador/testes).
 * Caminhos são relativos à pasta de dados do plugin, separados por "/".
 */
export interface Platform {
  readonly os: string;
  readonly hostVersion: string;
  readText(path: string): Promise<string | null>;
  /** Gravação atômica: arquivo temporário + renomeação. */
  writeText(path: string, text: string): Promise<void>;
  /** Grava binário de forma atômica e retorna o caminho nativo absoluto. */
  writeBinary(path: string, data: Uint8Array): Promise<string>;
  /** Caminho nativo do arquivo, ou null se não existir. */
  nativePath(path: string): Promise<string | null>;
  remove(path: string): Promise<void>;
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string | null): Promise<void>;
  fetch: typeof fetch;
}
