// The theme setting: which token block in styles.css is in force. Runs in the
// browser, before first paint (main.tsx) and from the Settings page.
// Reads and writes localStorage `corella.theme`; sets `data-theme` on <html>.
//
// A theme is only a name here. Its colours are one block of tokens in
// styles.css, so adding a theme is a new block there and a new entry in THEMES.
// "system" is resolved here rather than in CSS, so each theme's tokens are
// written once: `data-theme` always names a real block.

export const THEMES = [
  { id: "cream", name: "Cream", note: "Light. The default." },
  { id: "studio", name: "Studio", note: "Dark, for a dim room." },
  { id: "glass", name: "Glass", note: "The whole window as the readout's glowing screen." },
] as const;

export type NamedTheme = (typeof THEMES)[number]["id"];
/** "system" is Cream or Studio, following the operating system's light or dark. */
export type Theme = NamedTheme | "system";

const KEY = "corella.theme";

/**
 * 0.1.0 stored "light" and "dark" under the same key. They map to the themes
 * that replaced them, so nobody's choice is lost on upgrade.
 */
const OLD_VALUES: Record<string, NamedTheme> = { light: "cream", dark: "studio" };

export function parseTheme(stored: string | null): Theme {
  if (stored === "system") return "system";
  if (stored && Object.hasOwn(OLD_VALUES, stored)) return OLD_VALUES[stored]!;
  return THEMES.some((t) => t.id === stored) ? (stored as NamedTheme) : "system";
}

/**
 * Theme is a per-browser preference, not conversation state, so localStorage is
 * the right home for it — invariant 3 is about the event log, not UI chrome.
 */
export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    // Private browsing, or site data blocked. Fall through to the default.
    return "system";
  }
}

/** The theme a choice puts on screen: System becomes Cream or Studio. */
export function resolveTheme(theme: Theme): NamedTheme {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "studio" : "cream";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(theme));
  // The installed app's title bar takes the theme's ground, read from the
  // tokens so the colour is written in one place.
  const ground = getComputedStyle(root).getPropertyValue("--ground").trim();
  if (ground) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ground);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not being able to remember it is not worth failing over.
  }
}

/** While System is chosen, follow the operating system when it switches. */
export function followSystemTheme(): void {
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (loadTheme() === "system") applyTheme("system");
  });
}
