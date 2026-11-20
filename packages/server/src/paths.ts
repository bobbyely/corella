import { existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Reads a setting from `CORELLA_<name>`, falling back to the name it had
 * before the rename, so an existing setup keeps working after the upgrade.
 *
 * shortcut: the `KIROCHROME_*` fallback is for the 0.1.0 upgrade only; drop it
 * in 0.2.0.
 */
export function env(name: string): string | undefined {
  return process.env[`CORELLA_${name}`] ?? process.env[`KIROCHROME_${name}`];
}

/** The per-OS application data directory for an app folder called `name`. */
function osDataDir(name: string): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", name);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, name);
  }
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdg, name);
}

/** Per-OS application data directory. */
export function dataDir(): string {
  return env("DATA_DIR") || osDataDir("corella");
}

export const dbPath = () => join(dataDir(), "corella.db");
export const configPath = () => join(dataDir(), "config.json");

/**
 * Carries a KiroChrome install over to Corella, so the user keeps their chats:
 * the old data folder becomes the new one, and `kirochrome.db` (with its WAL
 * files) becomes `corella.db`. Runs once at boot, before anything opens the
 * database. Only ever renames, and only onto a name that is free: it never
 * overwrites and never deletes, so the worst case is that nothing moves.
 *
 * shortcut: the upgrade from the old name is for 0.1.0; drop it in 0.2.0.
 */
export function migrateFromKiroChrome(log: (line: string) => void = console.log): void {
  if (!env("DATA_DIR")) {
    const oldDir = osDataDir("kirochrome");
    const newDir = osDataDir("corella");
    if (!existsSync(newDir) && existsSync(oldDir)) {
      renameSync(oldDir, newDir);
      log(`Moved your data folder from ${oldDir} to ${newDir} (KiroChrome is now Corella).`);
    }
  }

  const dir = dataDir();
  if (existsSync(join(dir, "corella.db")) || !existsSync(join(dir, "kirochrome.db"))) return;
  // The WAL files go with the database: SQLite matches them by name, and
  // leaving one behind would lose whatever was not yet checkpointed.
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = join(dir, `kirochrome.db${suffix}`);
    const to = join(dir, `corella.db${suffix}`);
    if (existsSync(from) && !existsSync(to)) renameSync(from, to);
  }
  log(`Renamed your database in ${dir} from kirochrome.db to corella.db.`);
}

/**
 * Creates the data folder private to the user (0700): it holds the database,
 * the login token and the provider config. `mode` applies only on creation.
 */
export function ensureDataDir(): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
}
