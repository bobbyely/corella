// The data folder holds conversations, source code, provider env values and
// the login token, so it and every file in it are the user's alone.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const parent = mkdtempSync(join(tmpdir(), "kc-privacy-"));
const dir = join(parent, "not-yet-created");
process.env.CORELLA_DATA_DIR = dir;

after(() => rmSync(parent, { recursive: true, force: true }));

const mode = (path) => statSync(path).mode & 0o777;

describe("the data folder", { skip: process.platform === "win32" }, () => {
  it("is created 0700, with the database, its WAL files, the ledger and the token 0600", async () => {
    const { Store } = await import("../dist/store.js");
    const { recordProcess } = await import("../dist/processLedger.js");
    const { loadToken } = await import("../dist/auth.js");

    const store = new Store();
    assert.equal(mode(dir), 0o700);
    for (const file of ["corella.db", "corella.db-wal", "corella.db-shm"]) {
      assert.equal(mode(join(dir, file)), 0o600, file);
    }
    recordProcess(process.pid, "test");
    assert.equal(mode(join(dir, "processes.tsv")), 0o600);
    const token = loadToken();
    assert.equal(mode(join(dir, "token")), 0o600);
    assert.equal(loadToken(), token, "the token survives a restart");
  });
});
