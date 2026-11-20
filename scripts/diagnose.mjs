// What has your agent actually told us? Reads the local database and reports
// which ACP updates arrived, per conversation. Content is never printed.
//
//   node scripts/diagnose.mjs

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function dataDir() {
  // shortcut: KIROCHROME_DATA_DIR is the pre-0.1.0 name; drop it in 0.2.0.
  const set = process.env.CORELLA_DATA_DIR ?? process.env.KIROCHROME_DATA_DIR;
  if (set) return set;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "corella");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "corella");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "corella");
}

const path = join(dataDir(), "corella.db");
if (!existsSync(path)) {
  console.error(`No database at ${path} — has the server run on this machine?`);
  process.exit(1);
}
console.log(`database: ${path}\n`);

const db = new DatabaseSync(path, { readOnly: true });
const sessions = db.prepare(`SELECT id, title, provider_name, status FROM sessions ORDER BY updated_at DESC`).all();
if (sessions.length === 0) console.log("No conversations yet.");

for (const s of sessions) {
  const rows = db.prepare(`SELECT type, payload FROM events WHERE session_id = ? ORDER BY seq`).all(s.id);
  const kinds = {};
  let usage = null;
  for (const row of rows) {
    let key = row.type;
    if (row.type === "agent_update") {
      try {
        const update = JSON.parse(row.payload).update ?? {};
        key = `agent_update:${update.sessionUpdate ?? "?"}`;
        if (update.sessionUpdate === "usage_update") usage = update;
        // Kiro's own notification: a percentage, no token counts.
        if (update.sessionUpdate === "_kiro.dev/metadata" && typeof update.contextUsagePercentage === "number") {
          usage = { used: update.contextUsagePercentage, size: 100 };
        }
      } catch { /* unreadable row */ }
    }
    kinds[key] = (kinds[key] ?? 0) + 1;
  }

  console.log(`── ${JSON.stringify(s.title)}  (${s.provider_name}, ${s.status}, ${rows.length} events)`);
  console.log(
    usage && typeof usage.used === "number" && typeof usage.size === "number"
      ? `   context: ${Math.round((1 - usage.used / usage.size) * 100)}% left  (${usage.used}/${usage.size})`
      : "   context: agent never sent usage_update or _kiro.dev/metadata — the meter will show a dash",
  );
  for (const [kind, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`     ${kind}: ${n}`);
  console.log();
}
