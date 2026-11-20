#!/usr/bin/env node
// The `corella` command: starts the server and opens it in a browser, already
// logged in. Run by hand (`corella`, after `npm link` in the repo) or by
// `npm start`, which passes --no-open.
//
// Builds first only when the build is missing or older than the sources, since
// a full build on every start was most of the wait. Then runs the server in
// this same process, so Ctrl-C reaches it directly and it shuts its agents
// down as usual; there is no second process to forward signals to or leave
// behind.
//
// Reads: the repo's sources and build output (for staleness), package.json
// (for --version), the login token in the data folder (for the link).
// Settings: CORELLA_PORT, and everything the server itself reads.
// Options: see HELP in bin/cli.mjs.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HELP, UsageError, buildNeeded, defaultOpener, findAppBrowser, parseCliArgs } from "./cli.mjs";

// realpath, because `npm link` puts a symlink on PATH and the repo is where it points.
const root = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..");

let options;
try {
  options = parseCliArgs(process.argv.slice(2), process.env);
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  console.error(`${err.message}\n\n${HELP}`);
  process.exit(2);
}
if (options.help) {
  console.log(HELP);
  process.exit(0);
}
if (options.version) {
  console.log(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
  process.exit(0);
}

const reason = buildNeeded(root);
if (reason) {
  console.log(`Building first, because ${reason}.`);
  // npm is a .cmd script on Windows, which Node will only spawn through a shell.
  const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (build.status !== 0) {
    console.error("The build failed (above). Fix it, or run `npm install` if dependencies are missing.");
    process.exit(1);
  }
}

// node:sqlite is still marked experimental on Node 22 (stable on 24); the
// other start scripts pass --no-warnings=ExperimentalWarning for this, which a
// `#!/usr/bin/env node` line cannot portably do.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
  if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
  emitWarning.call(process, warning, ...rest);
};

process.env.CORELLA_PORT = String(options.port);
const serverDist = join(root, "packages", "server", "dist");
// Importing it starts it: index.js is the server's own boot sequence.
const { server } = await import(pathToFileURL(join(serverDist, "index.js")).href);

server.once("error", async (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(await portTakenMessage(options.port));
  process.exit(1);
});
const onListening = async () => {
  if (options.open === "none") return;
  // After the server's boot, so the data folder has been migrated and the
  // token exists; the server printed the same link.
  const { loadToken } = await import(pathToFileURL(join(serverDist, "auth.js")).href);
  const url = `http://127.0.0.1:${options.port}/?token=${loadToken()}`;
  if (options.open === "app") openApp(url);
  else openDefault(url);
};
if (server.listening) onListening();
else server.once("listening", onListening);

async function portTakenMessage(port) {
  let body = "";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
    body = await res.text();
  } catch {
    // Something holds the port but does not answer HTTP: not Corella.
  }
  if (body.includes("Corella")) {
    return `Corella is already running on port ${port}. Use that one (open the link it printed), stop it with Ctrl-C where it runs, or start another with --port ${port + 1}.`;
  }
  return `Port ${port} is in use by another program. Start Corella on a different one with --port ${port + 1}.`;
}

/**
 * Detached and unreferenced: the browser belongs to the user, not to this
 * server, so it must outlive Ctrl-C and must not keep this process alive.
 */
function launch(command, args, onFail) {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", onFail);
  child.unref();
}

function openDefault(url) {
  const { command, args } = defaultOpener(process.platform, url);
  launch(command, args, (err) => {
    console.log(`Could not open a browser (${command}: ${err.code ?? err.message}). Open the link above yourself.`);
  });
}

function openApp(url) {
  const browser = findAppBrowser({ platform: process.platform, env: process.env, exists: existsSync });
  if (!browser) {
    console.log("No Chrome, Edge, Brave or Chromium found for --app, so opening your normal browser instead.");
    return openDefault(url);
  }
  launch(browser, [`--app=${url}`], (err) => {
    console.log(`Could not start ${browser} (${err.code ?? err.message}), so opening your normal browser instead.`);
    openDefault(url);
  });
}
