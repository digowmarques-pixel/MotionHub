import { describe, expect, it } from "vitest";
import { ApplyOperation } from "../src/apply-state.js";
import { compareHostVersion, compareSemver } from "../src/semver.js";
import { canTransition } from "../src/asset.js";
import { can } from "../src/roles.js";

describe("ApplyOperation", () => {
  it("percorre o caminho feliz e registra eventos com correlação", () => {
    const op = new ApplyOperation("c-1", undefined, () => 0);
    for (const s of ["compatibility_checked", "validating", "preparing_host", "inserting", "verifying", "completed"] as const) op.advance(s);
    expect(op.done).toBe(true);
    expect(op.events.map((e) => e.state)).toEqual(["idle", "compatibility_checked", "validating", "preparing_host", "inserting", "verifying", "completed"]);
    expect(op.events.every((e) => e.correlationId === "c-1")).toBe(true);
  });

  it("rejeita transição inválida e registra falha", () => {
    const op = new ApplyOperation("c-2");
    expect(() => op.advance("inserting")).toThrow(/Transição inválida/);
    op.fail("host_no_sequence");
    expect(op.state).toBe("failed");
    expect(op.error?.code).toBe("host_no_sequence");
    op.fail("host_api_error");
    expect(op.error?.code).toBe("host_no_sequence");
  });
});

describe("utilitários", () => {
  it("compara semver e versões de host", () => {
    expect(compareSemver("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareHostVersion("25.6", "25.6.0")).toBe(0);
    expect(compareHostVersion("26.0", "25.6.1")).toBeGreaterThan(0);
  });

  it("aplica fluxo editorial e RBAC", () => {
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("review", "published")).toBe(true);
    expect(can("editor", "asset:publish")).toBe(false);
    expect(can("curator", "asset:publish")).toBe(true);
    expect(can("motion_designer", "asset:request_review")).toBe(true);
  });
});
