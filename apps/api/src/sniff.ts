/**
 * Detecção de formato pelo conteúdo (magic bytes), não pela extensão
 * (Especificação M09, §9 "extensão enganosa").
 */
export interface Sniffed {
  mime: string;
  ext: string[];
}

const startsWith = (b: Buffer, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString("latin1");

export function sniff(head: Buffer): Sniffed | null {
  if (head.length < 12) return null;
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return { mime: "application/zip", ext: ["mogrt", "zip", "mlpack"] };
  if (ascii(head, 0, 4) === "RIFX" && ascii(head, 8, 12) === "FaFX") return { mime: "application/x-adobe-ffx", ext: ["ffx"] };
  if (ascii(head, 0, 4) === "RIFX" || (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "Egg!")) return { mime: "application/vnd.adobe.aftereffects.project", ext: ["aep"] };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return { mime: "audio/wav", ext: ["wav"] };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return { mime: "image/webp", ext: ["webp"] };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return { mime: "image/png", ext: ["png"] };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: ["jpg", "jpeg"] };
  if (ascii(head, 0, 3) === "ID3" || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)) return { mime: "audio/mpeg", ext: ["mp3"] };
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand.startsWith("qt")) return { mime: "video/quicktime", ext: ["mov"] };
    return { mime: "video/mp4", ext: ["mp4", "m4v", "mov"] };
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", ext: ["webm"] };
  if (ascii(head, 0, 4) === "OTTO" || startsWith(head, [0x00, 0x01, 0x00, 0x00])) return { mime: "font/ttf", ext: ["ttf", "otf"] };
  // Texto: legendas SRT/VTT/JSON e .ffx (XML) são aceitos como texto UTF-8 sem bytes nulos.
  if (!head.includes(0)) {
    const s = head.toString("utf8").trimStart();
    if (s.startsWith("WEBVTT")) return { mime: "text/vtt", ext: ["vtt"] };
    if (s.startsWith("{") || s.startsWith("[")) return { mime: "application/json", ext: ["json"] };
    if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}/.test(s)) return { mime: "application/x-subrip", ext: ["srt"] };
  }
  return null;
}

export function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i + 1).toLowerCase();
}

/** Formato real precisa ser reconhecido e compatível com a extensão declarada. */
export function checkFileType(path: string, head: Buffer): { ok: true; mime: string } | { ok: false; reason: string } {
  const s = sniff(head);
  if (!s) return { ok: false, reason: "formato não reconhecido" };
  const ext = extOf(path);
  if (!s.ext.includes(ext)) return { ok: false, reason: `conteúdo (${s.mime}) não corresponde à extensão .${ext}` };
  return { ok: true, mime: s.mime };
}
