import { describe, expect, it } from "vitest";
import { defaultParameterValues, validateManifest, validateParameterValues } from "../src/manifest.js";
import { validManifest } from "./fixtures.js";

describe("validateManifest", () => {
  it("aceita o exemplo da especificação §6.1", () => {
    const r = validateManifest(validManifest);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.aspectRatio).toBe("any");
      expect(defaultParameterValues(r.manifest.parameters)).toEqual({ headline: "MEGALUME", primaryColor: "#FFFFFF", durationSec: 3 });
    }
  });

  it.each([
    ["../evil.mogrt"],
    ["/etc/passwd"],
    ["C:/Windows/x.mogrt"],
    ["template\\..\\x"],
    ["template/./x"],
    ["con.mogrt"],
  ])("recusa caminho inseguro %s", (path) => {
    const r = validateManifest({ ...validManifest, assets: [{ path, sha256: "a".repeat(64), role: "template" }] });
    expect(r.ok).toBe(false);
  });

  it("recusa default fora do intervalo e chaves duplicadas", () => {
    const r = validateManifest({
      ...validManifest,
      parameters: [
        { key: "d", type: "number", min: 1, max: 2, default: 5 },
        { key: "d", type: "bool", default: true },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["default acima de max", "parâmetro duplicado: d"]));
    }
  });

  it("recusa versão fora de semver e hash inválido", () => {
    expect(validateManifest({ ...validManifest, version: "1.2" }).ok).toBe(false);
    expect(validateManifest({ ...validManifest, assets: [{ path: "a.mogrt", sha256: "xyz", role: "template" }] }).ok).toBe(false);
  });
});

describe("validateParameterValues", () => {
  const params = validateManifest(validManifest);
  if (!params.ok) throw new Error("fixture inválida");
  const p = params.manifest.parameters;

  it("completa ausentes com default e aceita acentos/emoji", () => {
    const r = validateParameterValues(p, { headline: "Ação & Coração 🎬" });
    expect(r).toEqual({ ok: true, values: { headline: "Ação & Coração 🎬", primaryColor: "#FFFFFF", durationSec: 3 } });
  });

  it("rejeita fora de limite, tipo errado e chave desconhecida", () => {
    const r = validateParameterValues(p, { durationSec: 30, primaryColor: "red", foo: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path).sort()).toEqual(["durationSec", "foo", "primaryColor"]);
  });

  it("rejeita texto acima de maxLength", () => {
    expect(validateParameterValues(p, { headline: "x".repeat(121) }).ok).toBe(false);
  });
});
