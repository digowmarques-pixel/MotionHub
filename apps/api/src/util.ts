import { z } from "zod";
import { badRequest } from "./errors.js";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      "Dados de entrada inválidos.",
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export const uuid = z.uuid();
export const idParams = z.object({ id: z.uuid() });

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

export function decodeCursor(c: string | undefined): number {
  if (!c) return 0;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString());
    return Number.isInteger(v.o) && v.o >= 0 ? v.o : 0;
  } catch {
    throw badRequest("Cursor inválido.");
  }
}

export const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());
