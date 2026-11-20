import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, ensureDataDir, env } from "./paths.js";

/**
 * Optional JSON-RPC frame trace, enabled with CORELLA_TRACE=1.
 *
 * Off by default and deliberately dumb: append-only JSONL of every frame in
 * both directions. This is the difference between knowing and guessing when an
 * agent misbehaves.
 */
const enabled = env("TRACE") === "1";
let tracePath: string | null = null;

if (enabled) {
  ensureDataDir();
  tracePath = join(dataDir(), `trace-${Date.now()}.jsonl`);
  console.log(`[trace] writing JSON-RPC frames to ${tracePath}`);
}

export const traceEnabled = enabled;

export function trace(direction: "in" | "out", providerId: string, frame: unknown): void {
  if (!tracePath) return;
  try {
    appendFileSync(tracePath, `${JSON.stringify({ ts: Date.now(), direction, providerId, frame })}\n`, { mode: 0o600 });
  } catch {
    // Tracing must never take the server down.
  }
}
