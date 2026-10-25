/**
 * Abstração da plataforma (UXP no Premiere; mock no navegador/testes).
 * Caminhos são relativos à pasta de dados do plugin, separados por "/".
 */
/** Arquivo escolhido pelo usuário (diálogo do sistema), para copiar para a biblioteca. */
export interface PickedFile {
  readonly name: string;
}

/**
 * Biblioteca em pasta (modo sem servidor). Caminhos relativos à raiz, separados por "/".
 */
export interface FolderLibrary {
  /** Caminho para exibir ao usuário. */
  readonly displayPath: string;
  /** Lista as subpastas (até maxDepth níveis) com os nomes dos arquivos de cada uma. */
  scan(maxDepth: number): Promise<Array<{ dir: string; files: string[] }>>;
  readText(rel: string): Promise<string | null>;
  readBinary(rel: string): Promise<Uint8Array | null>;
  /** Caminho nativo absoluto (para o Premiere importar direto do NAS). */
  nativePath(rel: string): string;
  /** Cria uma subpasta nova (nome único), copia os arquivos e grava item.json. Retorna o nome da pasta criada. */
  addItem(dirName: string, files: Array<{ as: string; file: PickedFile }>, itemJson: string): Promise<string>;
}

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
  /** Pede ao usuário a pasta da biblioteca do Gerenciador e guarda o acesso. Retorna o caminho ou null. */
  connectLibrary(): Promise<string | null>;
  /** Lê <biblioteca>/index.json, se uma biblioteca estiver conectada. */
  readLibraryIndex(): Promise<string | null>;
  /** Pede ao usuário a pasta da biblioteca (ex.: no NAS) e guarda o acesso. Retorna o caminho ou null. */
  connectFolderLibrary(): Promise<string | null>;
  /** Biblioteca em pasta já conectada, ou null. */
  folderLibrary(): Promise<FolderLibrary | null>;
  /** Copia mídia para o cache do plugin e devolve uma URL utilizável em <img>/<video>. */
  cacheMedia(key: string, load: () => Promise<Uint8Array | null>): Promise<string | null>;
  /** Abre o diálogo do sistema para escolher um arquivo. */
  pickFile(kind: "any" | "image" | "video"): Promise<PickedFile | null>;
}
