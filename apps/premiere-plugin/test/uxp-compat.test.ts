/**
 * Guarda de compatibilidade com o UXP do Premiere (que não é um navegador completo).
 * Lista oficial de propriedades CSS: developer.adobe.com/premiere-pro/uxp/uxp-api/reference-css/styles/
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "plugin/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ui = readdirSync(join(root, "src/ui")).map((f) => [f, readFileSync(join(root, "src/ui", f), "utf8")] as const);

const SUPPORTED = new Set(
  `align-content align-items align-self background-attachment background-color background-image background-repeat background-size background
  border-bottom-color border-bottom-left-radius border-bottom-right-radius border-bottom-style border-bottom-width border-bottom border-color
  border-left-color border-left-style border-left-width border-left border-radius border-right-color border-right-style border-right-width
  border-right border-style border-top-color border-top-left-radius border-top-style border-top-width border-top border-width bottom color
  display flex-basis flex-direction flex-grow flex-shrink flex-wrap flex font-family font-size font-style font-weight height justify-content
  left letter-spacing margin-bottom margin-left margin-right margin-top margin max-height max-width min-height min-width opacity overflow-x
  overflow-y overflow padding-bottom padding-left padding-right padding-top padding right text-align text-overflow top visibility white-space width
  cursor`.split(/\s+/),
);

describe("compatibilidade UXP", () => {
  it("styles.css usa só propriedades suportadas pelo UXP", () => {
    const props = [...css.matchAll(/(?:^|[;{]\s*)(-?-?[a-z-]+)\s*:/gm)].map((m) => m[1]!).filter((p) => !p.startsWith("--"));
    const bad = [...new Set(props.filter((p) => !SUPPORTED.has(p)))];
    expect(bad).toEqual([]);
  });

  it("styles.css não usa seletores/recursos ausentes no UXP", () => {
    for (const re of [/:not\(/, /:focus-visible/, /\[hidden\]/, /@keyframes/, /\binset\b/]) expect(css).not.toMatch(re);
  });

  it("a interface não cria <button>, <select>, <details>, <form> nem usa o atributo hidden", () => {
    for (const [file, src] of ui) {
      expect(src, file).not.toMatch(/h\("(button|select|option|details|summary|form|fieldset)"/);
      expect(src, file).not.toMatch(/\.hidden\s*=|\bhidden:\s/);
    }
  });
});
