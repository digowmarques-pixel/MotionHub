import type { FolderLibrary, PickedFile, Platform } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (m: string) => any;

/** Implementação real sobre as APIs UXP (storage.localFileSystem e secureStorage). */
export async function createUxpPlatform(): Promise<Platform> {
  const uxp = require("uxp");
  const fs = uxp.storage.localFileSystem;
  const formats = uxp.storage.formats;
  const secure = uxp.storage.secureStorage;
  const root = await fs.getDataFolder();

  const folderFor = async (segments: string[], create: boolean): Promise<any | null> => {
    let folder = root;
    for (const seg of segments) {
      let next: any = null;
      try {
        next = await folder.getEntry(seg);
      } catch {
        next = null;
      }
      if (!next) {
        if (!create) return null;
        next = await folder.createFolder(seg);
      }
      folder = next;
    }
    return folder;
  };

  const split = (path: string) => {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name || parts.some((p) => p === "..")) throw new Error(`caminho inválido: ${path}`);
    return { dirs: parts, name };
  };

  const getFile = async (path: string): Promise<any | null> => {
    const { dirs, name } = split(path);
    const folder = await folderFor(dirs, false);
    if (!folder) return null;
    try {
      return await folder.getEntry(name);
    } catch {
      return null;
    }
  };

  const writeAtomic = async (path: string, data: string | Uint8Array, format: unknown): Promise<string> => {
    const { dirs, name } = split(path);
    const folder = await folderFor(dirs, true);
    const tmp = await folder.createFile(`${name}.partial`, { overwrite: true });
    await tmp.write(typeof data === "string" ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), { format });
    await tmp.moveTo(folder, { newName: name, overwrite: true });
    const final = await folder.getEntry(name);
    return final.nativePath as string;
  };

  // Arquivos escolhidos pelo usuário: o objeto exposto é opaco; a entrada UXP fica guardada aqui.
  const picked = new WeakMap<PickedFile, any>();

  const childOf = async (folder: any, name: string): Promise<any | null> => {
    try {
      return await folder.getEntry(name);
    } catch {
      return null;
    }
  };

  const resolveRel = async (base: any, rel: string): Promise<any | null> => {
    let cur = base;
    for (const seg of rel.split("/").filter(Boolean)) {
      if (seg === "..") return null;
      cur = await childOf(cur, seg);
      if (!cur) return null;
    }
    return cur;
  };

  /** Biblioteca em pasta (NAS): acesso por token persistente concedido pelo usuário. */
  const openFolderLibrary = (root: any): FolderLibrary => {
    const sep = String(root.nativePath).includes("\\") ? "\\" : "/";
    return {
      displayPath: root.nativePath as string,
      async scan(maxDepth) {
        const out: Array<{ dir: string; files: string[] }> = [];
        const walk = async (folder: any, rel: string, depth: number) => {
          const entries: any[] = await folder.getEntries();
          const files = entries.filter((e) => e.isFile).map((e) => e.name as string);
          if (rel && files.length) out.push({ dir: rel, files });
          if (depth >= maxDepth) return;
          for (const e of entries) if (e.isFolder && !String(e.name).startsWith(".")) await walk(e, rel ? `${rel}/${e.name}` : e.name, depth + 1);
        };
        await walk(root, "", 0);
        return out;
      },
      async readText(rel) {
        const f = await resolveRel(root, rel);
        return f ? ((await f.read({ format: formats.utf8 })) as string) : null;
      },
      async readBinary(rel) {
        const f = await resolveRel(root, rel);
        return f ? new Uint8Array((await f.read({ format: formats.binary })) as ArrayBuffer) : null;
      },
      nativePath(rel) {
        return joinNative(root.nativePath as string, rel, sep);
      },
      async addItem(dirName, files, itemJson) {
        let name = dirName;
        for (let i = 2; await childOf(root, name); i++) name = `${dirName}-${i}`;
        const folder = await root.createFolder(name);
        for (const { as, file } of files) {
          const src = picked.get(file);
          if (!src) throw new Error("Arquivo escolhido não está mais disponível.");
          const copy = await src.copyTo(folder, { overwrite: false });
          if (copy?.name !== as) await (await folder.getEntry(src.name)).moveTo(folder, { newName: as, overwrite: true });
        }
        const j = await folder.createFile("item.json", { overwrite: true });
        await j.write(itemJson, { format: formats.utf8 });
        return name;
      },
    };
  };

  return {
    os: (() => {
      try {
        return String(require("os").platform());
      } catch {
        return "desconhecido";
      }
    })(),
    hostVersion: String(uxp.host?.version ?? "0"),
    async readText(path) {
      const f = await getFile(path);
      return f ? ((await f.read({ format: formats.utf8 })) as string) : null;
    },
    async writeText(path, text) {
      await writeAtomic(path, text, formats.utf8);
    },
    writeBinary: (path, data) => writeAtomic(path, data, formats.binary),
    async nativePath(path) {
      const f = await getFile(path);
      return f ? (f.nativePath as string) : null;
    },
    async remove(path) {
      const f = await getFile(path);
      await f?.delete();
    },
    async secureGet(key) {
      try {
        const v = await secure.getItem(key);
        if (v == null) return null;
        return typeof v === "string" ? v : new TextDecoder().decode(v);
      } catch {
        return null;
      }
    },
    async secureSet(key, value) {
      if (value === null) await secure.removeItem(key);
      else await secure.setItem(key, value);
    },
    fetch: (...args) => fetch(...args),
    // Acesso à biblioteca do Gerenciador: o usuário escolhe a pasta uma vez (permissão "request")
    // e o plugin guarda um token persistente. POC: confirmar persistência entre sessões do Premiere.
    async connectLibrary() {
      const folder = await fs.getFolder();
      if (!folder) return null;
      const index = await folder.getEntry("index.json").catch(() => null);
      if (!index) throw new Error("Esta pasta não é uma biblioteca do Motion Hub (index.json não encontrado).");
      const token = await fs.createPersistentToken(folder);
      await writeAtomic("library-token.txt", token, formats.utf8);
      return folder.nativePath as string;
    },
    async connectFolderLibrary() {
      const folder = await fs.getFolder();
      if (!folder) return null;
      const token = await fs.createPersistentToken(folder);
      await writeAtomic("folder-library-token.txt", token, formats.utf8);
      return folder.nativePath as string;
    },
    async folderLibrary() {
      const tokenFile = await getFile("folder-library-token.txt");
      if (!tokenFile) return null;
      const token = (await tokenFile.read({ format: formats.utf8 })) as string;
      // Se o NAS estiver fora do ar, a exceção sobe e a interface avisa "biblioteca indisponível".
      const folder = await fs.getEntryForPersistentToken(token);
      return openFolderLibrary(folder);
    },
    async cacheMedia(key, load) {
      // O UXP exibe imagens/vídeos da pasta de dados do plugin (esquema plugin-data:), não de caminhos arbitrários.
      const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
      let f = await getFile(`cache/${safe}`);
      if (!f) {
        const bytes = await load();
        if (!bytes) return null;
        await writeAtomic(`cache/${safe}`, bytes, formats.binary);
        f = await getFile(`cache/${safe}`);
      }
      return (f?.url?.href as string | undefined) ?? `plugin-data:/cache/${safe}`;
    },
    async pickFile(kind) {
      const types = kind === "image" ? ["png", "jpg", "jpeg", "webp"] : kind === "video" ? ["mp4", "mov", "webm"] : undefined;
      const f = await fs.getFileForOpening(types ? { types } : {});
      if (!f) return null;
      const handle: PickedFile = { name: f.name as string };
      picked.set(handle, f);
      return handle;
    },
    async readLibraryIndex() {
      const tokenFile = await getFile("library-token.txt");
      if (!tokenFile) return null;
      try {
        const token = (await tokenFile.read({ format: formats.utf8 })) as string;
        const folder = await fs.getEntryForPersistentToken(token);
        const index = await folder.getEntry("index.json");
        return (await index.read({ format: formats.utf8 })) as string;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Junta a raiz nativa com um caminho relativo "a/b". Preserva prefixos de rede do Windows
 * (\\NAS\pasta) e não duplica separadores.
 */
export function joinNative(root: string, rel: string, sep: "/" | "\\"): string {
  const base = root.endsWith(sep) ? root.slice(0, -1) : root;
  const parts = rel.split("/").filter(Boolean);
  return parts.length ? `${base}${sep}${parts.join(sep)}` : base;
}
