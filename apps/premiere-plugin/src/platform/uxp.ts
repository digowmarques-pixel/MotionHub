import type { Platform } from "./types.js";

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
