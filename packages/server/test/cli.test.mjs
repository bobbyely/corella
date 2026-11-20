// The `corella` command's pure parts: arguments, the app-mode browser search,
// the default opener and the staleness check. Nothing here launches a browser
// or a server; the browser search gets a fake `exists`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT, UsageError, buildNeeded, defaultOpener, findAppBrowser, parseCliArgs } from "../../../bin/cli.mjs";

test("no arguments opens the default browser on the default port", () => {
  assert.deepEqual(parseCliArgs([], {}), { open: "browser", port: DEFAULT_PORT, help: false, version: false });
});

test("--app, --no-open, --help and --version", () => {
  assert.equal(parseCliArgs(["--app"]).open, "app");
  assert.equal(parseCliArgs(["--no-open"]).open, "none");
  assert.equal(parseCliArgs(["-h"]).help, true);
  assert.equal(parseCliArgs(["--version"]).version, true);
});

test("--app and --no-open together is a mistake, not last-one-wins", () => {
  assert.throws(() => parseCliArgs(["--app", "--no-open"]), UsageError);
  assert.equal(parseCliArgs(["--app", "--app"]).open, "app");
});

test("the port comes from --port, then CORELLA_PORT, then the default", () => {
  assert.equal(parseCliArgs(["--port", "4799"], { CORELLA_PORT: "4800" }).port, 4799);
  assert.equal(parseCliArgs(["--port=4799"]).port, 4799);
  assert.equal(parseCliArgs([], { CORELLA_PORT: "4800" }).port, 4800);
  assert.equal(parseCliArgs([], { KIROCHROME_PORT: "4801" }).port, 4801);
  assert.equal(parseCliArgs([], { CORELLA_PORT: "" }).port, DEFAULT_PORT);
});

test("a bad port or an unknown option is a UsageError", () => {
  for (const argv of [["--port"], ["--port", "abc"], ["--port", "0"], ["--port", "70000"], ["--port", "-1"], ["--open"], ["extra"]]) {
    assert.throws(() => parseCliArgs(argv), UsageError, argv.join(" "));
  }
  assert.throws(() => parseCliArgs([], { CORELLA_PORT: "x" }), UsageError);
});

const finds = (platform, env, present) => findAppBrowser({ platform, env, exists: (p) => present.includes(p) });

test("macOS: /Applications first, then ~/Applications", () => {
  const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
  const brave = "/Users/u/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
  assert.equal(finds("darwin", { HOME: "/Users/u" }, [brave, edge]), edge);
  assert.equal(finds("darwin", { HOME: "/Users/u" }, [brave]), brave);
});

test("Windows: Program Files and LocalAppData, then PATH with .exe", () => {
  const env = { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", Path: "C:\\bin;D:\\tools" };
  const userChrome = "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
  assert.equal(finds("win32", env, [userChrome]), userChrome);
  assert.equal(finds("win32", env, ["D:\\tools\\brave.exe"]), "D:\\tools\\brave.exe");
  assert.equal(finds("win32", env, ["D:\\tools\\brave"]), null);
});

test("Linux: searches PATH by the usual names", () => {
  const env = { PATH: "/usr/local/bin:/usr/bin:/snap/bin" };
  assert.equal(finds("linux", env, ["/snap/bin/chromium"]), "/snap/bin/chromium");
  assert.equal(finds("linux", env, ["/usr/bin/chromium", "/usr/bin/google-chrome"]), "/usr/bin/google-chrome");
  assert.equal(finds("linux", env, ["/opt/somewhere/chrome"]), null);
  assert.equal(finds("linux", {}, ["/usr/bin/chromium"]), null);
});

test("the default opener per platform", () => {
  const url = "http://127.0.0.1:4711/?token=abc";
  assert.deepEqual(defaultOpener("darwin", url), { command: "open", args: [url] });
  assert.deepEqual(defaultOpener("win32", url), { command: "cmd", args: ["/c", "start", "", url] });
  assert.deepEqual(defaultOpener("linux", url), { command: "xdg-open", args: [url] });
});

test("the build is needed when missing or older than a source, and not otherwise", () => {
  const root = mkdtempSync(join(tmpdir(), "corella-cli-"));
  const old = new Date(Date.now() - 60_000);
  const write = (rel, when = old) => {
    const file = join(root, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "x");
    utimesSync(file, when, when);
  };
  write("tsconfig.base.json");
  for (const pkg of ["shared", "server", "web"]) write(`packages/${pkg}/src/index.ts`);

  assert.match(buildNeeded(root), /packages\/shared has not been built/);

  const now = new Date();
  for (const pkg of ["shared", "server", "web"]) write(`packages/${pkg}/dist/index.js`, now);
  const later = new Date(Date.now() + 60_000);
  write("packages/server/tsconfig.tsbuildinfo", later);
  write("packages/server/test/x.test.mjs", later);
  assert.equal(buildNeeded(root), null);

  write("packages/web/src/App.tsx", later);
  assert.match(buildNeeded(root), /App\.tsx changed/);
  write("packages/web/src/App.tsx", old);
  write("packages/server/package.json", later);
  assert.match(buildNeeded(root), /server\/package\.json changed/);
  write("packages/server/package.json", old);

  // Vite copies the web app's manifest and icons into dist, so they are inputs too.
  write("packages/web/public/manifest.webmanifest", later);
  assert.match(buildNeeded(root), /manifest\.webmanifest changed/);
});
