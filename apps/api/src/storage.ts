/**
 * Armazenamento de objetos. Driver local para desenvolvimento/NAS;
 * a interface permite trocar por S3 compatível + CDN (Especificação §8).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";

export interface PutResult {
  key: string;
  bytes: number;
  sha256: string;
}

export interface StorageDriver {
  /** Grava de forma atômica (arquivo temporário + rename), calculando sha256 e tamanho. */
  put(key: string, body: Readable, opts?: { maxBytes?: number }): Promise<PutResult>;
  get(key: string, range?: { start: number; end: number }): Readable;
  size(key: string): Promise<number | null>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** Caminho local, quando o driver for de disco (usado pelo worker de previews). */
  localPath(key: string): string | null;
}

export class LocalStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) || key.includes("..")) throw new Error(`chave de storage inválida: ${key}`);
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root) + sep)) throw new Error("chave fora do diretório de storage");
    return p;
  }

  async put(key: string, body: Readable, opts: { maxBytes?: number } = {}): Promise<PutResult> {
    const final = this.pathFor(key);
    const tmp = join(this.root, ".tmp", randomUUID());
    await mkdir(dirname(final), { recursive: true });
    await mkdir(dirname(tmp), { recursive: true });
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (opts.maxBytes !== undefined && bytes > opts.maxBytes) return cb(new Error("arquivo excede o limite de tamanho"));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(body, meter, createWriteStream(tmp));
      await rename(tmp, final);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return { key, bytes, sha256: hash.digest("hex") };
  }

  get(key: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.pathFor(key), range);
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.pathFor(key))).size;
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  localPath(key: string): string {
    return this.pathFor(key);
  }
}
