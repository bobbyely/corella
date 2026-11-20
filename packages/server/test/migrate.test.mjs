// The upgrade from KiroChrome: the old data folder and database move to the
// new names so the user keeps their chats, and nothing is ever overwritten.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const { env, migrateFromKiroChrome } = await import("../dist/paths.js");

let xdg;
let logs;
const log = (line) => logs.push(line);
const saved = { ...process.env };

beforeEach(() => {
  xdg = mkdtempSync(join(tmpdir(), "corella-migrate-"));
  process.env.XDG_DATA_HOME = xdg;
  delete process.env.CORELLA_DATA_DIR;
  delete process.env.KIROCHROME_DATA_DIR;
  logs = [];
});

afterEach(() => {
  process.env = { ...saved };
  rmSync(xdg, { recursive: true, force: true });
});

function oldInstall(dir) {
  mkdirSync(dir, { recursive: true });
  for (const file of ["kirochrome.db", "kirochrome.db-wal", "kirochrome.db-shm", "config.json", "token"]) {
    writeFileSync(join(dir, file), `old ${file}`);
  }
}

// The per-OS folder is only XDG_DATA_HOME on Linux, which is what CI runs.
describe("moving a KiroChrome install to Corella", { skip: process.platform !== "linux" }, () => {
  it("moves the old folder and renames the database and its WAL files", () => {
    oldInstall(join(xdg, "kirochrome"));
    migrateFromKiroChrome(log);

    const dir = join(xdg, "corella");
    assert.equal(existsSync(join(xdg, "kirochrome")), false);
    assert.equal(readFileSync(join(dir, "corella.db"), "utf8"), "old kirochrome.db");
    assert.equal(readFileSync(join(dir, "corella.db-wal"), "utf8"), "old kirochrome.db-wal");
    assert.equal(readFileSync(join(dir, "corella.db-shm"), "utf8"), "old kirochrome.db-shm");
    assert.equal(readFileSync(join(dir, "config.json"), "utf8"), "old config.json");
    assert.equal(readFileSync(join(dir, "token"), "utf8"), "old token");
    assert.equal(logs.length, 2, "one line for the folder, one for the database");

    migrateFromKiroChrome(log);
    assert.equal(logs.length, 2, "a second start does nothing and says nothing");
  });

  it("leaves both folders alone when the new one already exists", () => {
    oldInstall(join(xdg, "kirochrome"));
    mkdirSync(join(xdg, "corella"));
    writeFileSync(join(xdg, "corella", "corella.db"), "new");
    migrateFromKiroChrome(log);

    assert.equal(readFileSync(join(xdg, "kirochrome", "kirochrome.db"), "utf8"), "old kirochrome.db");
    assert.equal(readFileSync(join(xdg, "corella", "corella.db"), "utf8"), "new");
    assert.deepEqual(logs, []);
  });

  it("does nothing on a fresh install", () => {
    migrateFromKiroChrome(log);
    assert.equal(existsSync(join(xdg, "corella")), false);
    assert.deepEqual(logs, []);
  });

  it("renames the database inside a folder set with the old variable, never overwriting", () => {
    const dir = join(xdg, "custom");
    oldInstall(dir);
    process.env.KIROCHROME_DATA_DIR = dir;
    assert.equal(env("DATA_DIR"), dir, "the old name is still read");

    migrateFromKiroChrome(log);
    assert.equal(readFileSync(join(dir, "corella.db"), "utf8"), "old kirochrome.db");
    assert.equal(existsSync(join(dir, "kirochrome.db")), false);
    assert.equal(existsSync(join(xdg, "corella")), false, "an explicit folder is never moved");

    writeFileSync(join(dir, "kirochrome.db"), "stray");
    migrateFromKiroChrome(log);
    assert.equal(readFileSync(join(dir, "corella.db"), "utf8"), "old kirochrome.db");
    assert.equal(readFileSync(join(dir, "kirochrome.db"), "utf8"), "stray");
  });

  it("prefers the new variable name over the old one", () => {
    process.env.KIROCHROME_DATA_DIR = "/old";
    process.env.CORELLA_DATA_DIR = "/new";
    assert.equal(env("DATA_DIR"), "/new");
  });
});
