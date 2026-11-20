import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTheme } from "../theme.ts";

describe("the stored theme", () => {
  it("maps 0.1.0's light and dark to the themes that replaced them", () => {
    assert.equal(parseTheme("light"), "cream");
    assert.equal(parseTheme("dark"), "studio");
  });

  it("keeps a named theme or System, and falls back to System for anything else", () => {
    for (const t of ["cream", "studio", "glass", "system"]) assert.equal(parseTheme(t), t);
    assert.equal(parseTheme(null), "system");
    assert.equal(parseTheme("neon"), "system");
    assert.equal(parseTheme("toString"), "system");
  });
});
