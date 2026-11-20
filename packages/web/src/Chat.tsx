import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { collectRoots, handoffText, isProviderFault, latestUsage } from "@corella/shared";
import type {
  ElicitationAction,
  ElicitationField,
  ElicitationValue,
  Handoff,
  KcEvent,
  ProviderRef,
  SessionUsage,
  StartOptions,
} from "@corella/shared";
import { Composer } from "./Composer.js";
import { KSpinner } from "./KSpinner.js";
import { ChangesPane } from "./ChangesPane.js";
import { FilesPane } from "./FilesPane.js";
import { SidePane, type SideTab } from "./SidePane.js";
import { collectChanges } from "./changes.js";
import { CodeBlock, DiffView } from "./DiffView.js";
import { MarkdownBody } from "./Markdown.js";
import { countChanges, lineDiff } from "./diff.js";
import { CueMark, Icon, type IconName } from "./icons.js";
import { MoreMenu } from "./MoreMenu.js";
import {
  buildRows,
  clockLabel,
  currentTurnStart,
  languageFor,
  toolContent,
  toolSubtitle,
  turnTimes,
  type Row,
  type ToolDiff,
} from "./timeline.js";
import { useChat } from "./useChat.js";

/** Rows rendered initially, and how many more each "show earlier" adds. */
const INITIAL_ROWS = 60;
const MORE_ROWS = 60;

export function Chat({
  providerId,
  cwd,
  start,
  sessionId,
  adopt,
  onStarted,
  onOpenSetup,
  onBack,
  onPlay,
}: {
  providerId?: string;
  cwd?: string;
  start?: StartOptions | undefined;
  sessionId?: string;
  /** A conversation the agent already had, being taken over for the first time. */
  adopt?: { agentSessionId: string; cwd: string; title: string | null };
  onStarted?: () => void;
  onOpenSetup?: () => void;
  /** Where this conversation was opened from, when that is not the sidebar. */
  onBack?: (() => void) | undefined;
  /** Opens the word games, which live with the sidebar. */
  onPlay?: () => void;
}) {
  const {
    connected,
    session,
    events,
    error,
    openSession,
    adoptSession,
    attachSession,
    resumeSession,
    setConfigOption,
    switchProvider,
    rememberOpening,
    answerPermission,
    answerElicitation,
    setAutoApprove,
    unqueue,
    commandOptions,
    requestCommandOptions,
    editQueued,
    moveQueued,
    prompt,
    interrupt,
    cancel,
  } = useChat();

  // The `@` picker completes against the conversation's roots. Keyed on the
  // joined string so the array is stable between events that do not change it,
  // and the composer does not re-render per delta.
  const rootsKey = session ? collectRoots(session.cwd, events).join("\0") : "";
  const roots = useMemo(() => (rootsKey ? rootsKey.split("\0") : []), [rootsKey]);

  // The switch divider shows the handoff on demand. Read through a ref so the
  // callback is stable and the memoized rows do not re-render on every event.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const cwdRef = useRef(session?.cwd ?? "");
  cwdRef.current = session?.cwd ?? "";
  const handoffFor = useCallback(
    (throughSeq: number, from: ProviderRef) => handoffText(eventsRef.current, throughSeq, from, cwdRef.current),
    [],
  );

  /** Whether the view is following new output, or the reader has scrolled away. */
  const [following, setFollowing] = useState(true);
  const transcript = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  /** The conversation already asked for, so a re-render does not ask twice. */
  const attached = useRef<string | null>(null);

  // This component is not remounted per conversation, so attaching is driven by
  // the target changing rather than by mounting. A dropped socket re-subscribes
  // itself from its high-water mark, which is why this does not run again on
  // reconnect.
  useEffect(() => {
    if (!connected) return;
    const target =
      sessionId ??
      (adopt ? `adopt:${providerId}:${adopt.agentSessionId}` : `new:${providerId}:${cwd}`);
    if (attached.current === target) return;
    attached.current = target;
    if (sessionId) attachSession(sessionId);
    else if (providerId && adopt) adoptSession(providerId, adopt);
    else if (providerId) openSession(providerId, cwd, start);
  }, [connected, openSession, adoptSession, attachSession, providerId, cwd, start, sessionId, adopt]);

  const allRows = useMemo(() => buildRows(events), [events]);
  const [windowSize, setWindowSize] = useState(INITIAL_ROWS);
  const [pane, setPane] = useState<SideTab | null>(null);

  // Long conversations render every row otherwise, and each agent message is a
  // full markdown parse. Show the most recent slice and let the reader ask for
  // more, which avoids a virtualisation library for a list this shape.
  const hidden = Math.max(0, allRows.length - windowSize);
  const rows = hidden > 0 ? allRows.slice(hidden) : allRows;
  const usage = useMemo(() => latestUsage(events), [events]);
  // The running sheet: each row's time since its turn began.
  const times = useMemo(() => turnTimes(events), [events]);
  // Counted here as well as in the pane, so the button can say there is
  // something behind it before it is opened.
  const changed = useMemo(() => collectChanges(events).length, [events]);

  // Changes as text streams into the last row, not just when a row is added —
  // otherwise a long reply scrolls once and then stops following.
  const tail = rows.at(-1);
  const growth = `${rows.length}:${tail && "text" in tail ? tail.text.length : 0}`;

  /** Cleared on switch: the first scroll into a conversation must not animate. */
  const landed = useRef(false);

  useLayoutEffect(() => {
    // Only follow if the reader is already at the bottom. Yanking them back
    // while they are reading earlier output is worse than not scrolling.
    if (!following) return;
    // Smooth is for output arriving while you watch. On arrival it is a visible
    // crawl from the top of the backlog, so the first scroll jumps instead —
    // before paint, so the top is never shown.
    bottom.current?.scrollIntoView({ behavior: landed.current ? "smooth" : "auto", block: "end" });
    if (rows.length > 0) landed.current = true;
  }, [growth, following, rows.length]);

  const onScroll = () => {
    const el = transcript.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setFollowing(distanceFromBottom < 120);
  };

  const jumpToLatest = () => {
    setFollowing(true);
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  // A conversation switched to should not inherit the previous one's expanded
  // window, scroll position or reading state. The component survives the
  // switch now, so this is reset rather than a fresh mount.
  useEffect(() => {
    setWindowSize(INITIAL_ROWS);
    setFollowing(true);
    setPane(null);
    landed.current = false;
  }, [sessionId, providerId, adopt?.agentSessionId]);

  useEffect(() => {
    if (session?.live) onStarted?.();
  }, [session?.live, onStarted]);

  // Resume replays the agent's whole history before the session goes live, which
  // can take a while on a long conversation; without this the click looks ignored.
  const [resuming, setResuming] = useState(false);
  useEffect(() => {
    setResuming(false);
  }, [sessionId, session?.live, error]);

  const busy = session?.busy ?? false;
  // A session read back from disk has no agent attached until it is resumed.
  const readOnly = session !== null && !session.live;

  return (
    <div className="chat-row">
      <div className="chat">
        <header className="chat-head">
          {onBack && (
            <button className="plain" onClick={onBack} title="Back to where this chat was opened from">
              <Icon name="back" />
              Back
            </button>
          )}
          <div className="chat-title">
            <h1>{session?.title ?? session?.providerName ?? "Conversation"}</h1>
            {session && (
              <p className="chat-sub">
                {session.providerName} · <code title={session.cwd}>{shortFolder(session.cwd)}</code>
                {!connected && <span className="chat-offline"> · Reconnecting…</span>}
              </p>
            )}
          </div>
          {/* Live sessions always show it; a restored one shows it whenever its
              log holds usage, since that history is still meaningful. */}
          {(session?.live || usage) && <Readout events={events} busy={busy} usage={usage} />}
          {session && (
            <button
              className={`plain ${pane === "changes" ? "active" : ""}`}
              onClick={() => setPane((p) => (p === "changes" ? null : "changes"))}
              title="Files the agent has changed in this chat"
              aria-pressed={pane === "changes"}
            >
              <Icon name="panel" />
              Changes
              {changed > 0 && <span className="count">{changed}</span>}
            </button>
          )}
          {session && (
            <MoreMenu
              items={[
                {
                  label: pane === "files" ? "Hide files" : "Files",
                  icon: <Icon name="folder" />,
                  onSelect: () => setPane((p) => (p === "files" ? null : "files")),
                },
                // A plain link: the server sets content-disposition, so the
                // browser handles the download without client-side blobs.
                {
                  label: "Export as Markdown",
                  icon: <Icon name="download" />,
                  href: `/api/sessions/${encodeURIComponent(session.id)}/export`,
                  download: true,
                },
                ...(onPlay ? [{ label: "Play a word game", icon: <Icon name="play" />, onSelect: onPlay }] : []),
              ]}
            />
          )}
        </header>

        <div className="transcript" ref={transcript} onScroll={onScroll}>
          {/* Inner wrapper caps line length; alignment happens inside it, so
              user messages can still sit right while the column stays centred. */}
          <div className="transcript-inner">
            {!session && <p className="muted">{sessionId ? "Loading conversation…" : "Starting agent…"}</p>}
            {hidden > 0 && (
              <button className="show-earlier" onClick={() => setWindowSize((n) => n + MORE_ROWS)}>
                Show earlier messages ({hidden} hidden)
              </button>
            )}
            {rows.map((row) => (
              <Step key={row.seq} time={times.get(row.seq)} cue={isOpenAsk(row)} divider={row.kind === "divider"}>
                <Message
                  row={row}
                  onPermission={answerPermission}
                  onElicitation={answerElicitation}
                  handoffFor={handoffFor}
                />
              </Step>
            ))}
            {busy && !session?.awaitingInput && (
              <Step time={undefined}>
                <div className="thinking">
                  <KSpinner label="Working" />
                </div>
              </Step>
            )}
            <div ref={bottom} />
          </div>
        </div>

        {!following && (
          <button className="jump-latest" onClick={jumpToLatest}>
            Jump to latest ↓
          </button>
        )}

        {error && (
          <div className="banner">
            <div className="banner-body">
              <strong>{error.code}</strong> {error.message}
              {error.remediation && <p className="remediation">{error.remediation}</p>}
            </div>
            {/* A provider fault is not this conversation's problem to solve. */}
            {isProviderFault(error.code) && onOpenSetup && (
              <button onClick={onOpenSetup}>Go to Settings</button>
            )}
          </div>
        )}

        {readOnly ? (
          <div className="composer readonly">
            <p className="muted">
              This conversation was restored from disk. Re-attach an agent to continue it.
            </p>
            <button
              className="primary"
              disabled={resuming}
              aria-busy={resuming}
              onClick={() => {
                if (!sessionId) return;
                setResuming(true);
                resumeSession(sessionId);
              }}
            >
              {resuming ? "Resuming… loading history" : "Resume conversation"}
            </button>
          </div>
        ) : (
          <Composer
            // Keyed so a half-typed message and its pasted images do not follow
            // the reader into the next conversation.
            key={session?.id ?? "new"}
            session={session}
            busy={busy}
            commandOptions={commandOptions}
            requestCommandOptions={requestCommandOptions}
            onPrompt={prompt}
            onInterrupt={interrupt}
            onCancel={cancel}
            onSetAutoApprove={setAutoApprove}
            onSetConfigOption={setConfigOption}
            onSwitchProvider={switchProvider}
            onRememberOpening={rememberOpening}
            roots={roots}
            onUnqueue={unqueue}
            onEditQueued={editQueued}
            onMoveQueued={moveQueued}
          />
        )}
      </div>
      {pane && session && (
        <SidePane
          tab={pane}
          onTab={setPane}
          onClose={() => setPane(null)}
          tabs={{
            changes: { label: "Changes", badge: changed > 0 ? <span className="count">{changed}</span> : null },
            files: { label: "Files" },
          }}
        >
          {pane === "changes" ? (
            <ChangesPane events={events} cwd={session.cwd} />
          ) : (
            <FilesPane sessionId={session.id} cwd={session.cwd} events={events} live={session.live} />
          )}
        </SidePane>
      )}
    </div>
  );
}

/**
 * One line of the running sheet: the time since the turn began down a ruled
 * left gutter, and the row beside it. Rows between turns get no time.
 */
function Step({
  time,
  cue = false,
  divider = false,
  children,
}: {
  time: number | undefined;
  cue?: boolean;
  divider?: boolean;
  children: React.ReactNode;
}) {
  if (divider) return <div className="step-gap" aria-hidden="true" />;
  return (
    <div className={`step ${cue ? "cue" : ""}`}>
      <span className="cuet">{time !== undefined ? clockLabel(time) : ""}</span>
      <div className="step-body">{children}</div>
    </div>
  );
}

/** A question still waiting on you: its time is marked in the cue colour. */
function isOpenAsk(row: Row): boolean {
  return (row.kind === "permission" && row.answeredWith === null) || (row.kind === "elicitation" && row.answer === null);
}

/** The last two parts of a path: enough to know the project, and nothing personal. */
function shortFolder(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? path : parts.slice(-2).join("/");
}

/**
 * One transcript row.
 *
 * Memoized because rendering a row is expensive — a prose row parses markdown
 * and highlights every code block — while its props are referentially stable:
 * `buildRows` is memoized on the event log, and the two handlers come from
 * `useChat` as `useCallback`s over a `send` that never changes. So anything
 * re-rendering `Chat` without new events bails out here instead of re-parsing
 * the whole visible transcript.
 */
const Message = memo(function Message({
  row,
  onPermission,
  onElicitation,
  handoffFor,
}: {
  row: Row;
  onPermission: (requestId: string, optionId: string | null) => void;
  onElicitation: AnswerElicitation;
  handoffFor: HandoffFor;
}) {
  switch (row.kind) {
    case "user":
      return (
        <div className="msg msg-user">
          {row.attachments.length > 0 && (
            <div className="msg-images">
              {row.attachments.map((a) => (
                <img key={a.id} src={`/api/attachments/${encodeURIComponent(a.id)}`} alt="attachment" />
              ))}
            </div>
          )}
          {row.text}
          {row.files.length > 0 && (
            <div className="msg-files">
              {row.files.map((f) => (
                <code key={f.path} className="msg-file" title={f.path}>
                  @{f.name}
                </code>
              ))}
            </div>
          )}
        </div>
      );
    case "command":
      return (
        <div className="compaction">
          <span className="compaction-rule" />
          <code>{row.text}</code>
          <span className="compaction-rule" />
        </div>
      );
    case "agent":
      // Plain text on the page, not a box: the agent's words are the content.
      return (
        <div className="msg-agent">
          <MarkdownBody>{row.text}</MarkdownBody>
        </div>
      );
    case "thought":
      return <div className="msg msg-thought">{row.text}</div>;
    case "tool":
      return <ToolCard row={row} />;
    case "permission":
      return <PermissionCard row={row} onAnswer={onPermission} />;
    case "elicitation":
      return <ElicitationCard row={row} onAnswer={onElicitation} />;
    case "note":
      return <div className="msg msg-note">{row.label}</div>;
    case "compaction":
      return <CompactionRow row={row} />;
    case "adopted":
      return <AdoptedRow row={row} />;
    case "switched":
      return <SwitchedRow row={row} handoffFor={handoffFor} />;
    case "work":
      return <WorkGroup row={row} onPermission={onPermission} onElicitation={onElicitation} handoffFor={handoffFor} />;
    case "divider":
      return <hr className="turn-divider" />;
    case "error":
      return (
        <div className="msg msg-error">
          <span className="code">{row.code}</span> {row.message}
          {row.remediation && <p className="remediation">{row.remediation}</p>}
        </div>
      );
  }
});

/**
 * A run of tool calls and thinking, collapsed into one row.
 *
 * Collapsed from the start, including while the agent is working. It used to
 * open itself during the turn to show progress, which meant the transcript was
 * at its most open exactly when it was moving fastest — a long think dumped
 * the whole thing on screen and the page jumped. Progress is on the summary
 * line instead: the count, the mark, and what the agent is doing right now.
 */
function WorkGroup({
  row,
  onPermission,
  onElicitation,
  handoffFor,
}: {
  row: Extract<Row, { kind: "work" }>;
  onPermission: (requestId: string, optionId: string | null) => void;
  onElicitation: AnswerElicitation;
  handoffFor: HandoffFor;
}) {
  const [open, setOpen] = useState(false);

  const parts = [
    row.tools > 0 ? `Ran ${row.tools} tool${row.tools === 1 ? "" : "s"}` : null,
    row.thoughts > 0 ? "thought" : null,
  ].filter(Boolean);
  // The newest tool call is what the agent is doing; the reader can tell
  // whether it is worth opening without opening it.
  const latest = row.active ? [...row.children].reverse().find((child) => child.kind === "tool") : undefined;

  return (
    <details
      className="work"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="work-mark">{row.active ? <i className="lamp" /> : <Icon name="chevRight" size={14} />}</span>
        <span className="work-what">{parts.join(" · ") || "Work"}</span>
        {latest?.kind === "tool" && <code className="work-now">{latest.title}</code>}
      </summary>
      <div className="work-children">
        {row.children.map((child) => (
          <Message
            key={child.seq}
            row={child}
            onPermission={onPermission}
            onElicitation={onElicitation}
            handoffFor={handoffFor}
          />
        ))}
      </div>
    </details>
  );
}

/** An icon per kind of action, so a step reads at a glance. */
const KIND_ICON: Record<string, IconName> = {
  read: "file", edit: "edit", delete: "cross", move: "chevRight", search: "search",
  execute: "term", think: "think", fetch: "download", switch_mode: "chevRight",
};

/**
 * One agent action, with all of its updates folded in: a single line until
 * opened. An edit opens to its diff, which is what you came to see; anything
 * else stays shut, since a transcript of tool output is unreadable.
 */
function ToolCard({ row }: { row: Extract<Row, { kind: "tool" }> }) {
  const subtitle = toolSubtitle(row.details);
  const content = toolContent(row.details);
  const hasBody = content.diffs.length > 0 || content.texts.length > 0;
  const summary = content.diffs.length > 0 ? diffSummary(content.diffs) : null;
  const running = row.status === "pending" || row.status === "in_progress";

  return (
    <details className={`tool tool-${row.status}`} open={content.diffs.length > 0 ? true : undefined}>
      <summary>
        <span className="tool-kind">
          {running ? <i className="lamp" /> : <Icon name={KIND_ICON[row.toolKind] ?? "chevRight"} size={15} />}
        </span>
        <span className="tool-title">{row.title}</span>
        {subtitle && subtitle !== row.title && <code className="tool-sub">{subtitle}</code>}
        {summary && (
          <span className="tool-stat">
            <ins>+{summary.added}</ins> <del>−{summary.removed}</del>
          </span>
        )}
        {row.status === "failed" && (
          <span className="tool-stat tool-failed-mark">
            <Icon name="cross" size={14} />
            Failed
          </span>
        )}
      </summary>

      <div className="tool-body">
        {content.diffs.map((diff, i) => (
          <DiffView key={`${diff.path}-${i}`} diff={diff} />
        ))}

        {content.texts.map((text, i) => (
          <CodeBlock key={i} text={text} language={languageFor(subtitle ?? "")} />
        ))}

        {content.terminalIds.map((id) => (
          <p key={id} className="muted tool-note">
            Output streamed to terminal {id.slice(0, 8)}
          </p>
        ))}

        {/* The raw payload stays reachable, just not in your face. */}
        <details className="tool-raw">
          <summary>{hasBody ? "Raw payload" : "No rendered content — raw payload"}</summary>
          <pre>{row.details.map((d) => JSON.stringify(d, null, 2)).join("\n")}</pre>
        </details>
      </div>
    </details>
  );
}

function diffSummary(diffs: ToolDiff[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const diff of diffs) {
    if (diff.oldText === null) continue; // the agent sent no before-text to count against
    const lines = lineDiff(diff.oldText, diff.newText);
    if (!lines) continue;
    const counts = countChanges(lines);
    added += counts.added;
    removed += counts.removed;
  }
  return { added, removed };
}

/**
 * The agent is blocked on this request until the user answers it: the CUE box,
 * the one thing in the transcript allowed to shout. Its answers are raised keys,
 * the first "allow once" the hot one, because a press here really matters.
 */
function PermissionCard({
  row,
  onAnswer,
}: {
  row: Extract<Row, { kind: "permission" }>;
  onAnswer: (requestId: string, optionId: string | null) => void;
}) {
  const answered = row.answeredWith !== null;
  const titleId = useId();
  if (answered) {
    return (
      <div className="ask answered" role="group" aria-labelledby={titleId}>
        <span className="ask-t" id={titleId}>{row.title}</span>
        <span className="muted">
          {row.answeredWith === "cancelled" ? "Cancelled" : `Answered: ${row.answeredWith}`}
        </span>
      </div>
    );
  }
  const hot = row.options.find((o) => o.kind === "allow_once") ?? row.options.find((o) => o.kind.startsWith("allow"));
  return (
    <div className="ask" role="group" aria-labelledby={titleId}>
      <div className="ask-h">
        <span className="tag cue">
          <CueMark />
          Cue
        </span>
        <span>Needs you</span>
      </div>
      {/* An alert, so a screen reader hears what the agent is blocked on. */}
      <div className="ask-q ask-t" id={titleId} role="alert">
        {row.title}
      </div>
      <div className="ask-b">
        {row.options.map((option) => (
          <button
            key={option.optionId}
            className={`hw ${option === hot ? "hot" : ""}`}
            onClick={() => onAnswer(row.requestId, option.optionId)}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const COMPACTION_LABEL: Record<string, string> = {
  in_progress: "Compacting context…",
  completed: "Context compacted",
  failed: "Compaction failed",
  cancelled: "Compaction cancelled",
};

/**
 * Where the agent replaced history with a summary.
 *
 * Shown in the transcript at the point it happened, because that is where the
 * conversation above it stopped being what the model can see. The summary is
 * the agent's own, so it is worth being able to read.
 */
function CompactionRow({ row }: { row: Extract<Row, { kind: "compaction" }> }) {
  const label = COMPACTION_LABEL[row.status] ?? `Compaction: ${row.status}`;
  const detail = row.error ?? row.summary;

  return (
    <div className={`compaction compaction-${row.status}`}>
      <span className="compaction-rule" />
      {detail ? (
        <details className="compaction-body">
          <summary>{label}</summary>
          {row.error ? <p className="remediation">{row.error}</p> : <MarkdownBody>{row.summary}</MarkdownBody>}
        </details>
      ) : (
        <span className="compaction-label">{label}</span>
      )}
      <span className="compaction-rule" />
    </div>
  );
}

/**
 * Where a conversation started in the agent's own CLI was taken over.
 *
 * Says so plainly, because the transcript above the seam is whatever the agent
 * chose to replay and Corella never saw it happen — it may be shorter than
 * the real conversation, and it holds no tool output we recorded ourselves.
 */
type HandoffFor = (throughSeq: number, from: ProviderRef) => Handoff;

/**
 * The seam where the conversation moved to another provider. What the new
 * agent was given is not in the log — it is derived from it — so the row
 * derives it the same way, on demand, and shows it verbatim: a prompt the
 * reader cannot see is a conversation nobody can debug.
 */
function SwitchedRow({ row, handoffFor }: { row: Extract<Row, { kind: "switched" }>; handoffFor: HandoffFor }) {
  const [open, setOpen] = useState(false);
  const handoff = open ? handoffFor(row.throughSeq, row.from) : null;
  return (
    <div className="compaction compaction-adopted">
      <span className="compaction-rule" />
      <details className="compaction-body" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Continued with {row.to.name}</summary>
        <p className="remediation">
          {row.from.name} left the conversation here. {row.to.name} was started fresh in the same directory and is given the
          transcript above as text with the next message sent — ACP has no way to hand a session from one agent to another.
        </p>
        {handoff && (
          <>
            <p className="remediation">
              {handoff.messages} message{handoff.messages === 1 ? "" : "s"}
              {handoff.omitted > 0 && `, the oldest ${handoff.omitted} dropped to fit`}. Sent as:
            </p>
            <pre className="handoff-text">{handoff.text}</pre>
          </>
        )}
      </details>
      <span className="compaction-rule" />
    </div>
  );
}

function AdoptedRow({ row }: { row: Extract<Row, { kind: "adopted" }> }) {
  return (
    <div className="compaction compaction-adopted">
      <span className="compaction-rule" />
      <details className="compaction-body">
        <summary>Adopted from {row.providerName}</summary>
        <p className="remediation">
          Everything above this line was replayed by {row.providerName} when this conversation was
          opened here, so it is the agent&rsquo;s own record rather than Corella&rsquo;s.
          Corella&rsquo;s log starts below it.
        </p>
      </details>
      <span className="compaction-rule" />
    </div>
  );
}

type AnswerElicitation = (
  requestId: string,
  action: ElicitationAction,
  content?: Record<string, ElicitationValue>,
) => void;

/** ACP string formats map onto input types the browser already validates. */
const FORMAT_INPUT: Record<string, string> = {
  email: "email",
  uri: "url",
  date: "date",
  "date-time": "datetime-local",
};

/**
 * A structured question from the agent, rendered as a form.
 *
 * Uncontrolled on purpose: the values live in the DOM until submit, so typing
 * an answer does not re-render the transcript, and `required`, `pattern` and
 * `min`/`max` are enforced by the browser rather than by hand. The server
 * re-checks everything anyway — the browser is not authoritative.
 */
function ElicitationCard({
  row,
  onAnswer,
}: {
  row: Extract<Row, { kind: "elicitation" }>;
  onAnswer: AnswerElicitation;
}) {
  if (row.answer) {
    const { action, content } = row.answer;
    return (
      <div className="elicitation answered">
        <div className="elicitation-head">{row.title ?? row.message}</div>
        <span className="muted">
          {action === "accept"
            ? Object.entries(content ?? {})
                .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
                .join(" · ") || "Answered"
            : action === "decline"
              ? "Declined"
              : "Cancelled"}
        </span>
      </div>
    );
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const content: Record<string, ElicitationValue> = {};

    for (const field of row.fields) {
      if (field.type === "multiselect") {
        content[field.key] = data.getAll(field.key).map(String);
        continue;
      }
      if (field.type === "boolean") {
        // An unchecked box sends nothing, and "false" is the answer, not silence.
        content[field.key] = data.get(field.key) !== null;
        continue;
      }
      const raw = data.get(field.key);
      if (typeof raw !== "string" || raw === "") continue;
      if (field.type === "number") {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) content[field.key] = parsed;
        continue;
      }
      content[field.key] = raw;
    }
    onAnswer(row.requestId, "accept", content);
  };

  return (
    <form className="elicitation" onSubmit={submit}>
      <div className="elicitation-head">{row.title ?? "The agent has a question"}</div>
      <p className="elicitation-message">{row.message}</p>

      {row.fields.map((field) => (
        <label key={field.key} className="elicitation-field">
          <span className="elicitation-label">
            {field.label}
            {field.required && <span className="required">*</span>}
          </span>
          {field.description && <span className="muted">{field.description}</span>}
          <ElicitationInput field={field} />
        </label>
      ))}

      <div className="elicitation-actions">
        <button type="submit" className="primary">Send</button>
        <button type="button" onClick={() => onAnswer(row.requestId, "decline")}>
          Decline
        </button>
      </div>
    </form>
  );
}

function ElicitationInput({ field }: { field: ElicitationField }) {
  switch (field.type) {
    case "boolean":
      return <input type="checkbox" name={field.key} defaultChecked={field.default ?? false} />;

    case "number":
      return (
        <input
          type="number"
          name={field.key}
          required={field.required}
          step={field.integer ? 1 : "any"}
          min={field.minimum}
          max={field.maximum}
          defaultValue={field.default}
        />
      );

    case "select":
      return (
        <select name={field.key} required={field.required} defaultValue={field.default ?? ""}>
          {/* An optional question needs a way to answer nothing. */}
          {!field.required && <option value="">—</option>}
          {field.choices.map((choice) => (
            <option key={choice.value} value={choice.value} title={choice.description}>
              {choice.label}
            </option>
          ))}
        </select>
      );

    case "multiselect":
      return (
        <span className="elicitation-choices">
          {field.choices.map((choice) => (
            <label key={choice.value} className="elicitation-choice">
              <input
                type="checkbox"
                name={field.key}
                value={choice.value}
                defaultChecked={field.default?.includes(choice.value) ?? false}
              />
              {choice.label}
            </label>
          ))}
        </span>
      );

    case "text":
      return (
        <input
          type={FORMAT_INPUT[field.format ?? ""] ?? "text"}
          name={field.key}
          required={field.required}
          minLength={field.minLength}
          maxLength={field.maxLength}
          pattern={field.pattern}
          defaultValue={field.default}
        />
      );
  }
}

/**
 * The glass readout: the one screen in the room, the same in every theme.
 * TURN is how long the running turn has taken (ticking while it runs, then
 * holding the last turn's length); CTX is how full the agent's memory is, as
 * five lit segments and a number. Usage comes from the log's usage updates.
 *
 * CTX shows "—" until the agent reports usage: an absent meter is
 * indistinguishable from a broken one, and not every agent sends usage.
 */
function Readout({ events, busy, usage }: { events: KcEvent[]; busy: boolean; usage: SessionUsage | null }) {
  const start = currentTurnStart(events);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || start === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [busy, start]);
  const turnMs = start !== null && busy ? now - start : lastTurnLength(events);

  const known = usage !== null && usage.size > 0;
  const usedPct = known ? Math.min(100, Math.round((usage.used / usage.size) * 100)) : 0;
  const lit = known ? Math.min(5, Math.ceil(usedPct / 20)) : 0;
  let title = "This agent has not reported how full its memory is";
  if (known) {
    const { used, size, cost, credits, percentOnly } = usage;
    const money = cost && new Intl.NumberFormat(undefined, { style: "currency", currency: cost.currency }).format(cost.amount);
    const spend = money ?? (credits !== undefined ? `${credits.toFixed(2)} credits so far` : "");
    // One decimal: a short turn moves a 200k window by a tenth of a percent,
    // and the rounded figure would look stuck.
    title = percentOnly
      ? `${(100 - used).toFixed(1)}% of the context window left${spend ? ` · ${spend}` : ""}`
      : `${(size - used).toLocaleString()} of ${size.toLocaleString()} tokens left ` +
        `(${used.toLocaleString()} used)${spend ? ` · ${spend}` : ""}`;
  }

  return (
    <div
      className="readout"
      role="group"
      aria-label={`Turn time ${turnMs !== null ? clockLabel(turnMs) : "none yet"}, context ${known ? `${usedPct} percent full` : "unknown"}`}
      title={title}
    >
      <span className="lab">Turn</span>
      <span className="clock">{turnMs !== null ? clockLabel(turnMs) : "--:--"}</span>
      <span className="lab">Ctx</span>
      <span className={`seg ${usedPct >= 85 ? "high" : ""}`} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={i < lit ? "on" : ""} />
        ))}
      </span>
      <span>{known ? `${usedPct}%` : "—"}</span>
    </div>
  );
}

/** How long the last finished turn took, or null when none has finished. */
function lastTurnLength(events: KcEvent[]): number | null {
  let start: number | null = null;
  let length: number | null = null;
  for (const event of events) {
    if (start === null && (event.type === "user_message" || event.type === "turn_start")) start = event.ts;
    if (event.type === "turn_end" && start !== null) {
      length = event.ts - start;
      start = null;
    }
  }
  return length;
}
