import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256, sha256Hex } from "../src/sha256.js";

describe("sha256 puro", () => {
  it.each([0, 1, 55, 56, 63, 64, 65, 1000, 100_000])("confere com node:crypto para %i bytes", (n) => {
    const data = randomBytes(n);
    expect(sha256Hex(data)).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("é incremental em pedaços arbitrários", () => {
    const data = randomBytes(10_007);
    const h = new Sha256();
    for (let i = 0; i < data.length; i += 333) h.update(data.subarray(i, i + 333));
    expect(h.digestHex()).toBe(createHash("sha256").update(data).digest("hex"));
  });
});
