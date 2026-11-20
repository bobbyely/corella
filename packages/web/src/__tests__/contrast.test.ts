// Every theme's text passes WCAG AA (4.5:1) on every background it is drawn
// on. Reads the token blocks straight out of styles.css, so a new theme, or a
// changed colour, is checked without touching this file.
// Run by `npm run test:unit`; reads styles.css, writes nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function themes(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [, name, body] of css.matchAll(/\[data-theme="(\w+)"\]\s*\{([^}]*)\}/g)) {
    const tokens = new Map<string, string>();
    for (const [, key, value] of body!.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) tokens.set(key!, value!.toLowerCase());
    out.set(name!, tokens);
  }
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const PAGES = ["ground", "sidebar", "surface"];
const SYNTAX = ["syn-comment", "syn-keyword", "syn-string", "syn-number", "syn-title", "syn-type", "syn-deletion", "syn-variable"];

// [ink, the backgrounds it is read on]
const PAIRS: [string, string[]][] = [
  ["text", [...PAGES, "add-bg", "del-bg", "cue-tint"]],
  ["muted", [...PAGES, "cue-tint"]],
  ["onair-text", PAGES],
  ["cue", [...PAGES, "cue-tint"]],
  ["ok", PAGES],
  ["warn", PAGES],
  ["add-ink", ["add-bg", ...PAGES]],
  ["del-ink", ["del-bg", ...PAGES]],
  ...SYNTAX.map((s): [string, string[]] => [s, ["surface", "ground", "add-bg", "del-bg"]]),
  // ink on a filled tag or key
  ["onair-ink", ["onair"]],
  ["cue-ink", ["cue"]],
  ["new-ink", ["new"]],
  ["keyink", ["keycap"]],
  ["keyhot-ink", ["keyhot"]],
];

describe("theme contrast", () => {
  const all = themes();

  it("finds the three themes", () => {
    assert.deepEqual([...all.keys()].sort(), ["cream", "glass", "studio"]);
  });

  for (const [theme, tokens] of all) {
    it(`${theme}: every text token passes 4.5:1 on its backgrounds`, () => {
      const fails: string[] = [];
      for (const [ink, grounds] of PAIRS) {
        const fg = tokens.get(ink);
        assert.ok(fg, `${theme} has no --${ink}`);
        for (const g of grounds) {
          const bg = tokens.get(g);
          assert.ok(bg, `${theme} has no --${g}`);
          const ratio = contrast(fg, bg);
          if (ratio < 4.5) fails.push(`--${ink} on --${g}: ${ratio.toFixed(2)}`);
        }
      }
      assert.deepEqual(fails, []);
    });
  }

  it("computes the textbook ratios", () => {
    assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
    assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
  });
});
