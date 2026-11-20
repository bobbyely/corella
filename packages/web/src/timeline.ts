import type {
  Attachment,
  ElicitationAction,
  ElicitationField,
  ElicitationValue,
  FileMention,
  KcEvent,
  PermissionOption,
  ProviderRef,
} from "@corella/shared";
import { isSlashCommand, updateCategory } from "@corella/shared";

/**
 * Folds the event log into renderable rows.
 *
 * The important job here is collapsing a tool call and all of its subsequent
 * updates into ONE row keyed by `toolCallId`. A single agent action emits a
 * `tool_call` plus several `tool_call_update`s; rendering each as its own row
 * buries the conversation.
 *
 * A pure function of the log, so a replay produces identical output.
 */
export type Row =
  | { kind: "user"; seq: number; text: string; attachments: Attachment[]; files: FileMention[] }
  | { kind: "command"; seq: number; text: string }
  | { kind: "agent"; seq: number; text: string }
  | { kind: "thought"; seq: number; text: string }
  | { kind: "tool"; seq: number; toolCallId: string; title: string; toolKind: string; status: string; details: unknown[] }
  | { kind: "permission"; seq: number; requestId: string; title: string; options: PermissionOption[]; answeredWith: string | null }
  | {
      kind: "elicitation";
      seq: number;
      requestId: string;
      message: string;
      title: string | undefined;
      fields: ElicitationField[];
      /** Null while the question is still open. */
      answer: { action: ElicitationAction; content?: Record<string, ElicitationValue> } | null;
    }
  | { kind: "note"; seq: number; label: string }
  /** Where a conversation the agent owns was taken over: history above, our log below. */
  | { kind: "adopted"; seq: number; providerName: string }
  /** The conversation moved to another provider here; the handoff is derived from the log on demand. */
  | { kind: "switched"; seq: number; from: ProviderRef; to: ProviderRef; throughSeq: number }
  /** Where the agent replaced conversation history with a summary. */
  | {
      kind: "compaction";
      seq: number;
      compactionId: string;
      status: string;
      summary: string;
      error: string | null;
    }
  /** Consecutive tool calls and thinking, folded into one collapsible run. */
  | { kind: "work"; seq: number; children: Row[]; tools: number; thoughts: number; active: boolean }
  | { kind: "error"; seq: number; code: string; message: string; remediation?: string | undefined }
  | { kind: "divider"; seq: number };

/**
 * The longest run of steps shown one line each. Each step is a single line on
 * the running sheet with its own time, so a few in a row read fine; a longer
 * run folds into one `work` line, so a turn of thirty reads does not bury the
 * answer. Five is about a screen's glance; change it here if that proves wrong.
 */
export const FOLD_AFTER = 5;

/**
 * Folds runs of more than FOLD_AFTER consecutive tool calls and thoughts into
 * a single `work` row, leaving every step one click away.
 */
function groupWork(rows: Row[]): Row[] {
  const out: Row[] = [];
  let run: Row[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length <= FOLD_AFTER) {
      out.push(...run);
    } else {
      const tools = run.filter((r) => r.kind === "tool");
      out.push({
        kind: "work",
        seq: run[0]!.seq,
        children: run,
        tools: tools.length,
        thoughts: run.filter((r) => r.kind === "thought").length,
        active: tools.some((r) => r.kind === "tool" && r.status !== "completed" && r.status !== "failed"),
      });
    }
    run = [];
  };

  for (const row of rows) {
    if (row.kind === "tool" || row.kind === "thought") run.push(row);
    else {
      flush();
      out.push(row);
    }
  }
  flush();
  return out;
}

/**
 * Applies one `compaction_update`, creating the row or patching it in place.
 *
 * ACP gives `summary` and `error` patch semantics: omitting a field leaves the
 * stored value alone, `null` clears it, and a value replaces it. Treating an
 * omission as "clear" would wipe the summary on the very update that reports
 * the compaction finished.
 */
function foldCompaction(
  seq: number,
  update: unknown,
  rows: Row[],
  index: Map<string, Extract<Row, { kind: "compaction" }>>,
): void {
  const u = update as {
    compactionId?: string;
    status?: string;
    summary?: Array<{ text?: string }> | null;
    error?: string | null;
  };
  if (!u.compactionId) return;

  let row = index.get(u.compactionId);
  if (!row) {
    row = {
      kind: "compaction",
      seq,
      compactionId: u.compactionId,
      status: u.status ?? "in_progress",
      summary: "",
      error: null,
    };
    index.set(u.compactionId, row);
    rows.push(row);
  } else if (u.status) {
    row.status = u.status;
  }

  // `summary: []` clears, same as null — the spec spells both out.
  if (u.summary === null) row.summary = "";
  else if (Array.isArray(u.summary)) {
    row.summary = u.summary.map((block) => block?.text ?? "").join("");
  }
  if (u.error !== undefined) row.error = u.error;
}

/**
 * The log without its quiet turns: a setting sent as a slash command
 * (`/effort high`), and the agent's answer to it. Errors stay, so a setting
 * that failed still says so, and so do questions and their answers: a quiet
 * turn that asks permission cannot finish until someone can see the question.
 */
const QUIET_KEEPS = new Set<KcEvent["type"]>([
  "error",
  "permission_request",
  "permission_resolved",
  "elicitation_request",
  "elicitation_resolved",
]);

export function withoutQuiet(events: KcEvent[]): KcEvent[] {
  let quiet = false;
  return events.filter((event) => {
    if (event.type === "user_message") quiet = event.quiet === true;
    if (!quiet) return true;
    if (event.type === "turn_end") quiet = false;
    return QUIET_KEEPS.has(event.type);
  });
}

export function buildRows(all: KcEvent[]): Row[] {
  const events = withoutQuiet(all);
  const rows: Row[] = [];
  const toolRows = new Map<string, Extract<Row, { kind: "tool" }>>();
  const permissionRows = new Map<string, Extract<Row, { kind: "permission" }>>();
  const elicitationRows = new Map<string, Extract<Row, { kind: "elicitation" }>>();
  const compactionRows = new Map<string, Extract<Row, { kind: "compaction" }>>();

  for (const event of events) {
    switch (event.type) {
      case "user_message":
        // A bare command (`/effort high`) is a setting, not something said: a
        // small line, not a bubble. With an image or file it is a request.
        if (isSlashCommand(event.text) && !event.attachments?.length && !event.files?.length) {
          rows.push({ kind: "command", seq: event.seq, text: event.text.trim() });
          break;
        }
        rows.push({
          kind: "user",
          seq: event.seq,
          text: event.text,
          attachments: event.attachments ?? [],
          files: event.files ?? [],
        });
        break;

      case "agent_text": {
        // Merge consecutive text so flush boundaries are invisible.
        const last = rows.at(-1);
        if (last?.kind === "agent") last.text += event.text;
        else rows.push({ kind: "agent", seq: event.seq, text: event.text });
        break;
      }

      case "tool_call": {
        const row: Extract<Row, { kind: "tool" }> = {
          kind: "tool",
          seq: event.seq,
          toolCallId: event.toolCallId,
          title: event.title,
          toolKind: event.kind,
          status: event.status,
          details: [event.raw],
        };
        toolRows.set(event.toolCallId, row);
        rows.push(row);
        break;
      }

      case "tool_call_update": {
        const row = toolRows.get(event.toolCallId);
        if (!row) break; // an update whose call predates the log we hold
        if (event.status) row.status = event.status;
        // A later update often carries the real title (the command actually run).
        const title = (event.raw as { title?: string })?.title;
        if (title) row.title = title;
        row.details.push(event.raw);
        break;
      }

      case "permission_request": {
        const row: Extract<Row, { kind: "permission" }> = {
          kind: "permission",
          seq: event.seq,
          requestId: event.requestId,
          title: event.title,
          options: event.options,
          answeredWith: null,
        };
        permissionRows.set(event.requestId, row);
        rows.push(row);
        break;
      }

      case "permission_resolved": {
        const row = permissionRows.get(event.requestId);
        if (row) row.answeredWith = event.optionId ?? event.outcome;
        break;
      }

      case "elicitation_request": {
        const row: Extract<Row, { kind: "elicitation" }> = {
          kind: "elicitation",
          seq: event.seq,
          requestId: event.requestId,
          message: event.message,
          title: event.title,
          fields: event.fields,
          answer: null,
        };
        elicitationRows.set(event.requestId, row);
        rows.push(row);
        break;
      }

      case "elicitation_resolved": {
        const row = elicitationRows.get(event.requestId);
        if (row) row.answer = { action: event.action, content: event.content };
        break;
      }

      case "agent_update": {
        const u = event.update as { sessionUpdate?: string; content?: { text?: string } };

        // Compaction is upserted by id: the first update fixes its place in the
        // timeline and later ones patch it there, rather than adding rows.
        if (u.sessionUpdate === "compaction_update") {
          foldCompaction(event.seq, event.update, rows, compactionRows);
          break;
        }
        if (u.sessionUpdate === "compaction_summary_chunk") {
          const c = event.update as { compactionId?: string; content?: { text?: string } };
          const row = c.compactionId ? compactionRows.get(c.compactionId) : undefined;
          if (row) row.summary += c.content?.text ?? "";
          break;
        }

        if (updateCategory(u.sessionUpdate) === "state") break; // header state, not transcript

        // An adopted conversation's own history arrives as ACP updates rather
        // than as our `user_message` events, so what the user said is a
        // `user_message_chunk`. Without this it would render as an unnamed
        // note, or worse, look like something the agent said.
        if (u.sessionUpdate === "user_message_chunk") {
          const text = u.content?.text ?? "";
          if (!text) break;
          const last = rows.at(-1);
          if (last?.kind === "user") last.text += text;
          else rows.push({ kind: "user", seq: event.seq, text, attachments: [], files: [] });
          break;
        }

        if (u.sessionUpdate === "agent_thought_chunk") {
          const last = rows.at(-1);
          const text = u.content?.text ?? "";
          if (last?.kind === "thought") last.text += text;
          else rows.push({ kind: "thought", seq: event.seq, text });
          break;
        }
        rows.push({ kind: "note", seq: event.seq, label: u.sessionUpdate ?? "update" });
        break;
      }

      case "error":
        rows.push({
          kind: "error",
          seq: event.seq,
          code: event.error.code,
          message: event.error.message,
          remediation: event.error.remediation,
        });
        break;

      case "resumed":
        rows.push({ kind: "note", seq: event.seq, label: "Agent re-attached" });
        break;

      case "adopted":
        rows.push({ kind: "adopted", seq: event.seq, providerName: event.providerName });
        break;

      case "provider_switched":
        rows.push({ kind: "switched", seq: event.seq, from: event.from, to: event.to, throughSeq: event.throughSeq });
        break;

      case "agent_exited":
        rows.push({
          kind: "note",
          seq: event.seq,
          label: `Agent exited (${event.signal ?? `code ${event.code}`})`,
        });
        break;

      case "interrupted":
        rows.push({ kind: "note", seq: event.seq, label: "Interrupted — the next message was sent now" });
        break;
      case "root_added":
        rows.push({ kind: "note", seq: event.seq, label: `Added ${event.path} to Files` });
        break;
      case "root_removed":
        rows.push({ kind: "note", seq: event.seq, label: `Removed ${event.path} from Files` });
        break;
      case "turn_end":
        if (rows.length > 0) rows.push({ kind: "divider", seq: event.seq });
        break;

      // turn_start drives the busy indicator, not the transcript.
    }
  }
  return groupWork(rows);
}

/** Best-effort one-line summary of what a tool call actually did. */
export function toolSubtitle(details: unknown[]): string | null {
  for (const detail of details) {
    const d = detail as { rawInput?: Record<string, unknown>; content?: unknown };
    const input = d?.rawInput;
    if (!input) continue;
    const candidate = input["command"] ?? input["file_path"] ?? input["path"] ?? input["pattern"];
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

export interface ToolDiff {
  path: string;
  /**
   * `null` when the agent sent no `oldText` at all. ACP makes it optional, and
   * absent is not the same as empty: an edit to an existing file whose before
   * text the agent did not include is not a newly created file.
   */
  oldText: string | null;
  newText: string;
}

interface ToolContent {
  diffs: ToolDiff[];
  texts: string[];
  terminalIds: string[];
}

/**
 * Pulls the renderable parts out of a tool call's updates.
 *
 * ACP's `ToolCallContent` has three shapes — `content`, `diff` and `terminal` —
 * and later updates supersede earlier ones for the same call, so the last
 * update carrying content wins rather than concatenating every revision.
 */
export function toolContent(details: unknown[]): ToolContent {
  const result: ToolContent = { diffs: [], texts: [], terminalIds: [] };

  for (let i = details.length - 1; i >= 0; i--) {
    const content = (details[i] as { content?: unknown })?.content;
    if (!Array.isArray(content) || content.length === 0) continue;

    for (const entry of content as Array<Record<string, unknown>>) {
      if (entry["type"] === "diff") {
        const path = typeof entry["path"] === "string" ? entry["path"] : "";
        result.diffs.push({
          path,
          oldText: typeof entry["oldText"] === "string" ? entry["oldText"] : null,
          newText: typeof entry["newText"] === "string" ? entry["newText"] : "",
        });
      } else if (entry["type"] === "terminal") {
        const id = entry["terminalId"];
        if (typeof id === "string") result.terminalIds.push(id);
      } else {
        const inner = entry["content"] as { type?: string; text?: string } | undefined;
        if (inner?.type === "text" && inner.text) result.texts.push(inner.text);
      }
    }
    break; // the latest update with content is authoritative
  }
  return result;
}

/** Language hint for highlighting, from a file path. */
export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", rs: "rust", go: "go", sh: "bash", bash: "bash", zsh: "bash",
    json: "json", css: "css", scss: "scss", less: "less", html: "xml", xml: "xml", svg: "xml",
    md: "markdown", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", sql: "sql",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", java: "java", kt: "kotlin", swift: "swift",
    rb: "ruby", php: "php", lua: "lua", pl: "perl", r: "r", diff: "diff", patch: "diff",
    makefile: "makefile", dockerfile: "dockerfile", graphql: "graphql", proto: "protobuf",
  };
  // Own keys only: a file named `x.constructor` would otherwise get a function.
  return Object.hasOwn(map, ext) ? map[ext]! : "";
}

/** Seconds as a running-sheet time: `00:25`, or `1:02:07` past an hour. */
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The running sheet's times: for each event inside a turn, how long after the
 * turn began it happened. The turn begins at your message (or the agent's
 * `turn_start`, whichever is first) and ends at `turn_end`; anything between
 * turns gets no time. Derived from the log, so a replay shows the same times.
 */
export function turnTimes(events: KcEvent[]): Map<number, number> {
  const times = new Map<number, number>();
  let start: number | null = null;
  for (const event of events) {
    if (start === null && (event.type === "user_message" || event.type === "turn_start")) start = event.ts;
    if (start !== null) times.set(event.seq, event.ts - start);
    if (event.type === "turn_end") start = null;
  }
  return times;
}

/** When the turn now running began, or null between turns. */
export function currentTurnStart(events: KcEvent[]): number | null {
  let start: number | null = null;
  for (const event of events) {
    if (start === null && (event.type === "user_message" || event.type === "turn_start")) start = event.ts;
    if (event.type === "turn_end") start = null;
  }
  return start;
}

/** A question still waiting on you: its time is marked in the cue colour. */
export function isOpenAsk(row: Row): boolean {
  return (row.kind === "permission" && row.answeredWith === null) || (row.kind === "elicitation" && row.answer === null);
}

/**
 * One key per question still open in a chat, space-separated. A key per
 * question, not a flag per chat, so a second question is news too.
 */
export function openAskKeys(sessionId: string, rows: Row[]): string {
  return rows
    .filter(isOpenAsk)
    .map((r) => `${sessionId}:${"requestId" in r ? r.requestId : ""}`)
    .join(" ");
}
