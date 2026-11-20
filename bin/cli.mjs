// The `corella` command's decisions, kept apart from its side effects so they
// can be tested: reading the arguments, finding a browser that has an app mode,
// the command that opens the default browser, and whether the build is stale.
//
// Imported by bin/corella.mjs and by packages/server/test/cli.test.mjs. Reads
// the file system only to check paths and modification times; writes nothing.
// Settings: CORELLA_PORT (KIROCHROME_PORT still honoured, as the server does).
//
// Plain JavaScript rather than a workspace package: the command has to run
// before anything is built, so it cannot depend on a build step.

import { readdirSync, statSync } from "node:fs";
import { join, posix, win32 } from "node:path";

export const DEFAULT_PORT = 4711;

export const HELP = `Usage: corella [options]

Starts Corella and opens it in your browser, already logged in.

Options:
  --app          Open in its own window (Chrome, Edge, Brave or Chromium app mode)
  --no-open      Open nothing; just print the login link
  --port <n>     Listen on port n (default ${DEFAULT_PORT}; also CORELLA_PORT)
  -v, --version  Print the version
  -h, --help     Print this help

Ctrl-C stops the server. The browser window stays open.`;

/** A mistake in how the command was called: printed with the help, exit code 2. */
export class UsageError extends Error {}

function parsePort(value, from) {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new UsageError(`${from} needs a port number from 1 to 65535, not ${JSON.stringify(value ?? "")}.`);
  }
  return Number(value);
}

/**
 * Hand-rolled rather than node:util parseArgs, from when Corella supported
 * Node 22.5, before parseArgs had the `allowNegative` that `--no-open` needs.
 * It is tested and small, so it stayed when the minimum moved to 22.16.
 */
export function parseCliArgs(argv, env = {}) {
  let open;
  let port;
  let help = false;
  let version = false;
  const setOpen = (mode, flag) => {
    if (open !== undefined && open !== mode) throw new UsageError(`${flag} cannot be used with --${open === "none" ? "no-open" : open}.`);
    open = mode;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--app") setOpen("app", arg);
    else if (arg === "--no-open") setOpen("none", arg);
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--version" || arg === "-v") version = true;
    else if (arg === "--port") port = parsePort(argv[++i], "--port");
    else if (arg.startsWith("--port=")) port = parsePort(arg.slice("--port=".length), "--port");
    else throw new UsageError(`Unknown option: ${arg}`);
  }
  const fromEnv = env.CORELLA_PORT ?? env.KIROCHROME_PORT;
  if (port === undefined && fromEnv !== undefined && fromEnv !== "") port = parsePort(fromEnv, "CORELLA_PORT");
  return { open: open ?? "browser", port: port ?? DEFAULT_PORT, help, version };
}

// Chromium-family only: they are the browsers with an `--app=<url>` window.
// Firefox dropped its equivalent (site-specific browser) in 2021.
const MAC_APPS = [
  "Google Chrome.app/Contents/MacOS/Google Chrome",
  "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "Brave Browser.app/Contents/MacOS/Brave Browser",
  "Chromium.app/Contents/MacOS/Chromium",
];
const WINDOWS_APPS = [
  "Google\\Chrome\\Application\\chrome.exe",
  "Microsoft\\Edge\\Application\\msedge.exe",
  "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  "Chromium\\Application\\chrome.exe",
];
const PATH_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chrome",
  "microsoft-edge",
  "microsoft-edge-stable",
  "msedge",
  "brave-browser",
  "brave",
  "chromium",
  "chromium-browser",
];

/**
 * The first browser with an app mode, or null. The usual install folders
 * first, then PATH, so it works on Linux (where PATH is the usual place) and
 * finds a portable install anywhere. `exists` is injected so tests need no
 * real browser.
 */
export function findAppBrowser({ platform, env, exists }) {
  const path = platform === "win32" ? win32 : posix;
  const candidates = [];
  if (platform === "darwin") {
    for (const base of ["/Applications", env.HOME && path.join(env.HOME, "Applications")]) {
      if (base) candidates.push(...MAC_APPS.map((app) => path.join(base, app)));
    }
  }
  if (platform === "win32") {
    for (const base of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]) {
      if (base) candidates.push(...WINDOWS_APPS.map((app) => path.join(base, app)));
    }
  }
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const suffix = platform === "win32" ? ".exe" : "";
  for (const name of PATH_NAMES) {
    candidates.push(...dirs.map((dir) => path.join(dir, name + suffix)));
  }
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

/** The command that hands a URL to the user's default browser. */
export function defaultOpener(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url] };
  // `start` is a cmd built-in; its first quoted argument is a window title,
  // hence the empty one.
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

/** The build's inputs and outputs, per workspace package, relative to the repo root. */
export const PACKAGES = ["packages/shared", "packages/server", "packages/web"];

function newest(dir, skip) {
  let best = { time: 0, file: null };
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return best; // a missing folder holds nothing, which is what the caller asks
  }
  for (const entry of entries) {
    if (skip(entry)) continue;
    const full = join(dir, entry.name);
    const found = entry.isDirectory() ? newest(full, skip) : { time: statSync(full).mtimeMs, file: full };
    if (found.time > best.time) best = found;
  }
  return best;
}

/**
 * Why the build must run, or null when it is current. A package is stale when
 * anything in its `src`, or a file beside it (package.json, tsconfig.json,
 * vite.config.ts, index.html), is newer than everything in its `dist`. Not its
 * `test` folder: the build never writes anything for that, so an edited test
 * would make every start rebuild.
 *
 * shortcut: compares times, not contents, and ignores node_modules, so an
 * `npm install` that changes a dependency is not noticed; run `npm run build`
 * by hand then. Upgrade to content hashes if that ever bites.
 */
export function buildNeeded(root) {
  const base = statSync(join(root, "tsconfig.base.json")).mtimeMs;
  for (const pkg of PACKAGES) {
    const output = newest(join(root, pkg, "dist"), () => false);
    if (output.time === 0) return `${pkg} has not been built yet`;
    const source = newest(join(root, pkg, "src"), () => false);
    const beside = newest(join(root, pkg), (entry) => entry.isDirectory() || entry.name.endsWith(".tsbuildinfo"));
    const input = source.time > beside.time ? source : beside;
    if (input.time > output.time) return `${input.file.slice(root.length + 1)} changed since the last build`;
    if (base > output.time) return "tsconfig.base.json changed since the last build";
  }
  return null;
}
