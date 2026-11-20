import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { env, migrateFromKiroChrome } from "./paths.js";
import { reapOrphans } from "./processLedger.js";

/**
 * `node:sqlite` landed in Node 22.5.0. Without this check an older Node fails
 * with an opaque module-not-found from deep inside the store — exactly the kind
 * of unhelpful failure this project exists to avoid.
 */
function requireNode(minimum: [number, number]): void {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const [reqMajor, reqMinor] = minimum;
  if (major > reqMajor || (major === reqMajor && minor >= reqMinor)) return;

  console.error(
    `Corella needs Node ${reqMajor}.${reqMinor} or newer (for the built-in node:sqlite).\n` +
      `This is Node ${process.versions.node}, at ${process.execPath}.\n\n` +
      `If you use nvm:  nvm install 22 && nvm use 22\n` +
      `Otherwise see https://nodejs.org/`,
  );
  process.exit(1);
}

requireNode([22, 5]);

// Before anything reads the data folder, so an upgrade from KiroChrome keeps
// its chats, config and process ledger.
migrateFromKiroChrome();

// Once, before anything spawns: clean up after a server that died without
// getting the chance to. Never do this per-session — it would kill processes
// belonging to sessions that are still running.
reapOrphans();

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "..", "..", "web", "dist");
const port = Number(env("PORT") ?? 4711);

// Imported only now: loading the server pulls in modules that create the data
// folder (the frame trace), which would stop the old folder moving across.
const { startServer } = await import("./http.js");
// Exported for bin/corella.mjs, which imports this file to start the server
// and waits on the handle to open the browser or explain a busy port.
export const server = startServer(port, existsSync(join(webDist, "index.html")) ? webDist : null);
