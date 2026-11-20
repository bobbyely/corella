import { useEffect, useMemo, useRef, useState } from "react";
import { keepNewChat, readNewChat, waitingStep, type PromptResult } from "./firstMessage.js";
import type { CommandOption, ConfigOption, FileEntry, ProviderView, SessionSummary, SlashCommand } from "@corella/shared";
import { fetchDirectory } from "./api.js";
import { commonPrefix, complete } from "./commands.js";
import { completeMention, mentionAt, mentionPath, mentionedIn, splitMention } from "./mentions.js";
import { useReadyProviders } from "./useReadyProviders.js";
import { fileToImage, type PendingImage } from "./images.js";
import { Icon } from "./icons.js";
import { MoreMenu } from "./MoreMenu.js";

/**
 * A new chat's own pickers. The agent and the folder are chosen here before
 * anything is said, and changing either starts a fresh agent rather than
 * moving a conversation.
 */
export interface DraftChoice {
  /** Every configured agent, so one that failed its check can say why. */
  providers: ProviderView[] | null;
  providerId: string | null;
  onProvider: (id: string) => void;
  folders: string[];
  cwd: string;
  onFolder: (path: string) => void;
}

/** The last two parts of a path (`project/api`): the browser does not know the home folder. */
export function shortFolder(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? path : parts.slice(-2).join("/");
}

/**
 * Effort sits beside the model. Recognised by what was advertised: ACP's
 * `thought_level` category, or a name that says effort (Kiro's `/effort`,
 * an `effortLevel` option).
 */
const isEffort = (id: string, category?: string): boolean => category === "thought_level" || /effort/i.test(id);

/**
 * The message box and everything that belongs to it.
 *
 * Split out of `Chat` for a reason that is not tidiness: `draft` changes on
 * every keystroke, and while it lived in `Chat` each character re-rendered the
 * whole transcript — up to 60 rows, every prose row re-parsing its markdown and
 * re-highlighting its code. Keeping the fast-changing state in a sibling of the
 * transcript rather than its parent is what stops that at the source.
 */
export function Composer({
  session,
  busy,
  commandOptions,
  requestCommandOptions,
  onPrompt,
  onInterrupt,
  onCancel,
  onSetAutoApprove,
  onSetConfigOption,
  onSwitchProvider,
  onRememberOpening,
  onUnqueue,
  onEditQueued,
  onMoveQueued,
  onQuietCommand,
  roots,
  draft: choice,
  autoFocus = false,
  waitingOn = null,
  ready = false,
  agentName,
}: {
  session: SessionSummary | null;
  busy: boolean;
  /** The conversation's directories, working directory first — what `@` completes against. */
  roots: string[];
  /** Agent-supplied argument suggestions, keyed by "command\u0000partial". */
  commandOptions: Record<string, CommandOption[]>;
  requestCommandOptions: (command: string, partial: string) => void;
  /** False when the message could not be sent, so the box keeps it. */
  onPrompt: (text: string, images: Array<{ mime: string; data: string }>, files: string[]) => PromptResult;
  /** Like `onPrompt`, but cancels the running turn first. */
  onInterrupt: (text: string, images: Array<{ mime: string; data: string }>, files: string[]) => void;
  onCancel: () => void;
  onSetAutoApprove: (enabled: boolean) => void;
  onSetConfigOption: (configId: string, value: string | boolean) => void;
  onSwitchProvider: (providerId: string) => void;
  /** A command chosen from a picker is what the next new chat on this provider opens with. */
  onRememberOpening: (providerId: string, opening: string) => void;
  onUnqueue: (index: number) => void;
  onEditQueued: (index: number, text: string) => void;
  onMoveQueued: (from: number, to: number) => void;
  /** Sends a setting the agent offers only as a slash command, without it showing as said. */
  onQuietCommand: (text: string) => void;
  /** Set on a new chat; see `DraftChoice`. */
  draft?: DraftChoice | undefined;
  autoFocus?: boolean;
  /** The new chat's agent start in flight, if any: a message sent now waits on it. */
  waitingOn?: string | null;
  /** The agent is up, so a waiting message can go. */
  ready?: boolean;
  agentName?: string | undefined;
}) {
  const [draft, setDraft] = useState(() => (choice ? readNewChat() : ""));
  /** The start a message is waiting on; while set, the box is kept as it is. */
  const [pendingOn, setPendingOn] = useState<string | null>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  /** Index of the highlighted command while the slash picker is open. */
  const [commandIndex, setCommandIndex] = useState(0);
  /** Paths picked from the `@` picker. Only these are sent as files; typed-by-hand `@` is prose. */
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  /** Directory listings the picker has fetched, by "root\0dir". */
  const [dirs, setDirs] = useState<Map<string, FileEntry[]>>(() => new Map());

  const box = useRef<HTMLTextAreaElement>(null);
  const queued = session?.queued ?? [];
  const canAttach = session?.supportsImages === true;

  const submit = (mode: "queue" | "now" = "queue") => {
    const text = draft.trim();
    // Deliberately allowed while busy: the server queues it and sends it when
    // the current turn ends — or, with "now", cuts the turn short for it.
    if (!text && images.length === 0) return;
    const send = mode === "now" ? onInterrupt : onPrompt;
    const result = send(text, images.map(({ mime, data }) => ({ mime, data })), mentionedIn(text, chosen));
    if (result === false) return;
    if (typeof result === "object") return setPendingOn(result.pendingOn);
    // Now, not in the effect that saves it: a first message turns the new
    // chat into a conversation in this same render, and that effect then skips.
    if (choice) keepNewChat("");
    setDraft("");
    setImages([]);
    setChosen(new Set());
  };

  // The new chat's words survive a reload; once sent, the box is empty and so is this.
  useEffect(() => {
    if (choice) keepNewChat(draft);
  }, [choice, draft]);

  // A message waiting for the agent goes once that same start is up. Any other
  // outcome (a new folder or agent, a failed start, a dropped socket) leaves
  // it in the box, unsent, to be sent again by hand.
  useEffect(() => {
    if (pendingOn === null) return;
    const step = waitingStep(pendingOn, waitingOn, ready);
    if (step === "wait") return;
    setPendingOn(null);
    if (step === "send") submit();
  });

  // `@` completes against the directory the partial names: the working
  // directory for a relative one, whichever root contains an absolute one.
  // Listings come from the Files endpoint and are kept for the composer's life.
  const mention = mentionAt(draft);
  const cwd = roots[0] ?? "";
  const listing = useMemo(() => {
    if (!mention) return null;
    const { dir, absolute } = splitMention(mention.typed);
    const root = absolute ? roots.find((r) => dir === `${r}/` || dir.startsWith(`${r}/`)) : cwd;
    if (!root) return null;
    const rel = absolute ? dir.slice(root.length + 1) : dir;
    return { root, path: rel.replace(/\/$/, "") };
  }, [mention?.typed, roots, cwd]);
  const listingKey = listing ? `${listing.root}\0${listing.path}` : null;
  useEffect(() => {
    if (!listing || !listingKey || !session || dirs.has(listingKey)) return;
    let stale = false;
    fetchDirectory(session.id, listing.root, listing.path)
      .then((res) => !stale && setDirs((m) => new Map(m).set(listingKey, res.entries)))
      .catch(() => !stale && setDirs((m) => new Map(m).set(listingKey, [])));
    return () => {
      stale = true;
    };
  }, [listingKey, listing, session, dirs]);

  // Ask the agent for real suggestions while an argument is being typed. It may
  // not support it, in which case nothing comes back and the hint-derived
  // values below stand on their own.
  const argPhase = /^\/(\S+)\s+(\S*)$/.exec(draft);
  useEffect(() => {
    if (argPhase) requestCommandOptions(argPhase[1]!, argPhase[2] ?? "");
  }, [argPhase?.[1], argPhase?.[2], requestCommandOptions]);

  // Terminal-style completion: command names first, then their arguments.
  const agentOptions = argPhase ? commandOptions[`${argPhase[1]}\u0000${argPhase[2] ?? ""}`] : undefined;
  const matches = useMemo(
    () =>
      mention
        ? completeMention(draft, mention, listingKey ? dirs.get(listingKey) : undefined, roots.slice(1))
        : complete(draft, session?.commands ?? [], agentOptions),
    [draft, mention, listingKey, dirs, roots, session?.commands, agentOptions],
  );
  const picking = matches.length > 0;
  const active = matches[Math.min(commandIndex, matches.length - 1)];

  const choose = (replacement: string) => {
    setDraft(replacement);
    setCommandIndex(0);
    const path = mentionPath(replacement);
    if (path) setChosen((prev) => new Set(prev).add(path));
  };

  /**
   * Tab behaves like a shell: complete to the longest shared prefix when the
   * choice is ambiguous, and only commit when it is not.
   */
  const tabComplete = () => {
    if (matches.length === 1) return choose(matches[0]!.replacement);
    const shared = commonPrefix(matches.map((m) => m.replacement));
    if (shared.length > draft.length) choose(shared);
  };

  /** Collects images from a paste or drop, ignoring anything else. */
  const collect = async (files: FileList | File[] | null) => {
    if (!canAttach || !files) return;
    const picked: PendingImage[] = [];
    for (const file of Array.from(files)) {
      const image = await fileToImage(file);
      if (image) picked.push(image);
    }
    if (picked.length > 0) setImages((prev) => [...prev, ...picked]);
  };

  /** The @ key: starts a mention where the cursor is, the same as typing one. */
  const startMention = () => {
    const el = box.current;
    if (!el) return;
    const at = el.selectionStart ?? draft.length;
    const before = draft.slice(0, at);
    const insert = before === "" || /\s$/.test(before) ? "@" : " @";
    setDraft(before + insert + draft.slice(el.selectionEnd ?? at));
    const caret = at + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const empty = !draft.trim() && images.length === 0;

  return (
    <div className="dock">
    <div className="composer">
      {queued.length > 0 && (
        <div className="queued">
          <span className="queued-label">Queued ({queued.length})</span>
          {queued.map((text, i) => (
            <QueuedItem
              key={`${i}-${text}`}
              text={text}
              index={i}
              total={queued.length}
              onEdit={(next) => onEditQueued(i, next)}
              onMove={(delta) => onMoveQueued(i, i + delta)}
              onRemove={() => onUnqueue(i)}
            />
          ))}
        </div>
      )}
      {picking && (
        <div className="commands">
          {matches.map((match, i) => (
            <button
              key={match.replacement}
              className={`command ${match === active ? "on" : ""}`}
              onMouseEnter={() => setCommandIndex(i)}
              onClick={() => choose(match.replacement)}
            >
              <span className="command-name">{match.label}</span>
              <span className="command-desc">{match.detail}</span>
              {match.hint && <span className="command-hint">{match.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="attachments">
          {images.map((image) => (
            <div key={image.key} className="attachment">
              <img src={`data:${image.mime};base64,${image.data}`} alt={image.name} />
              <button
                aria-label={`Remove ${image.name}`}
                onClick={() => setImages((prev) => prev.filter((i) => i.key !== image.key))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-box">
      {pendingOn !== null && (
        <p className="composer-waiting" role="status">
          <span className="lamp starting" aria-hidden />
          Sends when {agentName ?? "the agent"} is ready
          <button className="link" onClick={() => setPendingOn(null)}>
            Cancel
          </button>
        </p>
      )}
      <textarea
        ref={box}
        value={draft}
        readOnly={pendingOn !== null}
        aria-label="Message"
        autoFocus={autoFocus}
        placeholder={
          choice
            ? "What should we work on?"
            : busy
            ? "Type to queue for when this turn ends…"
            : canAttach
              ? "Reply, or type @ to add a file. Paste or drop an image"
              : "Reply, or type @ to add a file"
        }
        onPaste={(e) => void collect(e.clipboardData?.files ?? null)}
        onDragOver={(e) => canAttach && e.preventDefault()}
        onDrop={(e) => {
          if (!canAttach) return;
          e.preventDefault();
          void collect(e.dataTransfer?.files ?? null);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (picking) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setCommandIndex((i) => (i + delta + matches.length) % matches.length);
              return;
            }
            if (e.key === "Tab") {
              e.preventDefault();
              tabComplete();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && active) {
              e.preventDefault();
              choose(active.replacement);
              return;
            }
            if (e.key === "Escape") {
              setDraft("");
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            // Cmd/Ctrl+Enter while the agent works: do not wait for it.
            submit((e.metaKey || e.ctrlKey) && busy ? "now" : "queue");
          }
        }}
        rows={2}
      />
      <div className="composer-bar">
        <div className="composer-config">
          <button className="pick icon" onClick={startMention} aria-label="Add a file" title="Add a file (@)" disabled={!session}>
            <Icon name="at" />
          </button>
          {choice ? (
            <DraftAgentPicker draft={choice} />
          ) : (
            session?.live && <ProviderPicker session={session} busy={busy} onSwitch={onSwitchProvider} />
          )}
          {session &&
            pickers(session).map((picker) =>
              picker.kind === "option" ? (
                <ConfigPicker
                  key={picker.option.id}
                  option={picker.option}
                  onChange={(value) => onSetConfigOption(picker.option.id, value)}
                />
              ) : (
                <CommandPicker
                  key={picker.command.name}
                  command={picker.command}
                  options={commandOptions[`${picker.command.name}\u0000`]}
                  onOpen={() => requestCommandOptions(picker.command.name, "")}
                  onChoose={(value) => {
                    // Quietly: a setting, not something said. Remembered, so
                    // the next new chat on this agent starts with it too.
                    const command = `/${picker.command.name} ${value}`;
                    onQuietCommand(command);
                    onRememberOpening(session.providerId, command);
                  }}
                />
              ),
            )}
          {choice && <FolderPicker draft={choice} />}
        </div>
        <div className="composer-buttons">
          {session?.live && (
            // On, it is a lit lamp and its word at every width: this chat is
            // not going to ask before it runs a command. Beside Send rather
            // than in the pickers' row, which scrolls sideways when narrow and
            // carried it out of sight under its fade.
            <label
              className={`pick toggle ${session.autoApprove ? "auto-on" : ""}`}
              title={
                session.autoApprove
                  ? "Auto-approving: the agent's tool calls are allowed once without asking. Untick to be asked."
                  : "Approve the agent's tool calls without asking"
              }
            >
              {session.autoApprove ? <i className="lamp" aria-hidden="true" /> : <Icon name="shield" size={15} />}
              <input
                type="checkbox"
                checked={session.autoApprove}
                onChange={(e) => onSetAutoApprove(e.target.checked)}
              />
              <span className={session.autoApprove ? undefined : "squeeze"}>Auto-approve</span>
            </label>
          )}
          {/* Stop is there only while there is something to stop. */}
          {busy && (
            <button className="plain" onClick={onCancel} title="Stop the agent">
              <Icon name="stop" size={14} />
              <span className="squeeze">Stop</span>
            </button>
          )}
          {busy && !empty && (
            <button
              className="plain"
              onClick={() => submit("now")}
              title="Cancel the current turn and send this now (Cmd/Ctrl+Enter). What the agent was doing is abandoned."
            >
              Interrupt &amp; send
            </button>
          )}
          {/* Live while the agent works, because typing then queues: with an
              empty box a press puts the cursor there to say so. */}
          <button
            className="hw hot send"
            onClick={() => (empty ? box.current?.focus() : submit())}
            disabled={busy ? !session : empty || (!session && !choice)}
            aria-label={busy ? "Send when this turn ends" : "Send"}
            title={busy ? "Send when this turn ends (Enter)" : "Send (Enter)"}
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </div>
      </div>
    </div>
    </div>
  );
}

/** A message waiting to send: editable and reorderable until its turn comes. */
function QueuedItem({
  text,
  index,
  total,
  onEdit,
  onMove,
  onRemove,
}: {
  text: string;
  index: number;
  total: number;
  onEdit: (text: string) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== text) onEdit(draft);
  };

  if (editing) {
    return (
      <input
        className="queued-edit"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(text);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="queued-item">
      <span className="queued-text" title={text}>
        {text}
      </span>
      <button aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button
        aria-label="Move down"
        title="Move down"
        disabled={index === total - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
      <button aria-label="Edit queued message" title="Edit" onClick={() => { setDraft(text); setEditing(true); }}>
        ✎
      </button>
      <button className="queued-remove" aria-label="Remove queued message" title="Remove" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

/**
 * Commands whose argument the agent enumerates, offered as pickers beside the
 * settings — but not where a setting already covers the same thing, which
 * would put two controls for one knob on the row. Matched by name against
 * option ids and categories; `agent` is what some CLIs call ACP's mode.
 */
function pickableCommands(session: SessionSummary): SlashCommand[] {
  const covered = new Set<string>();
  for (const option of session.configOptions) {
    covered.add(option.id);
    if (option.category) covered.add(option.category);
    if (isEffort(option.id, option.category)) covered.add("effort");
  }
  if (covered.has("mode")) covered.add("agent");
  return session.commands.filter((c) => c.selection && !covered.has(c.name));
}

type Picker = { kind: "option"; option: ConfigOption } | { kind: "command"; command: SlashCommand };

/** The row's settings in reading order: the model, then effort, then the rest as advertised. */
function pickers(session: SessionSummary): Picker[] {
  const all: Picker[] = [
    ...session.configOptions.map((option) => ({ kind: "option" as const, option })),
    ...pickableCommands(session).map((command) => ({ kind: "command" as const, command })),
  ];
  const rank = (p: Picker) =>
    p.kind === "option" && p.option.category === "model"
      ? 0
      : isEffort(p.kind === "option" ? p.option.id : p.command.name, p.kind === "option" ? p.option.category : undefined)
        ? 1
        : 2;
  // Array sort is stable, so equal ranks keep the agent's own order.
  return all.sort((a, b) => rank(a) - rank(b));
}

/**
 * The new chat's agent. Every configured agent is listed; one that failed its
 * check, or is still being checked, is shown but cannot be chosen, and says
 * why, so a missing agent is not a mystery.
 */
function DraftAgentPicker({ draft }: { draft: DraftChoice }) {
  const providers = draft.providers ?? [];
  const reason = (p: ProviderView): string | null =>
    p.lastCheck?.status === "ok"
      ? null
      : p.checking
        ? "checking…"
        : (p.lastCheck?.error?.message ?? (p.lastCheck ? "failed its check" : "not checked yet"));
  return (
    <label className="pick" title="The agent this chat starts with. Each is checked when Corella starts; Settings says more.">
      <select aria-label="Agent" value={draft.providerId ?? ""} onChange={(e) => draft.onProvider(e.target.value)}>
        {!draft.providerId && <option value="">No agent ready</option>}
        {providers.map((p) => {
          const why = reason(p);
          return (
            <option key={p.id} value={p.id} disabled={why !== null} title={why ?? undefined}>
              {why ? `${p.name} — ${why}` : p.name}
            </option>
          );
        })}
      </select>
      <Icon name="chev" size={14} />
    </label>
  );
}

/**
 * The new chat's folder: the ones worked in before, most recent first, and
 * "Choose another…" for a path not among them. Typed, because a browser page
 * cannot open the system's folder chooser and learn the path.
 */
function FolderPicker({ draft }: { draft: DraftChoice }) {
  const [typing, setTyping] = useState(false);
  const [path, setPath] = useState("");
  // Holds both the field and the menu's key, so Enter or Escape can hand
  // focus back to the key once it is drawn again (a blur leaves focus be).
  const wrap = useRef<HTMLSpanElement>(null);
  if (typing) {
    const done = (commit: boolean, refocus = false) => {
      setTyping(false);
      if (commit && path.trim()) draft.onFolder(path.trim());
      if (refocus) requestAnimationFrame(() => wrap.current?.querySelector("button")?.focus());
    };
    return (
      <span className="folder-pick" ref={wrap}>
      <input
        className="pick folder-input"
        aria-label="Folder path"
        autoFocus
        value={path}
        placeholder="/path/to/project"
        spellCheck={false}
        onChange={(e) => setPath(e.target.value)}
        onBlur={() => done(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            done(true, true);
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            done(false, true);
          }
        }}
      />
      </span>
    );
  }
  const folders = draft.folders.includes(draft.cwd) || !draft.cwd ? draft.folders : [draft.cwd, ...draft.folders];
  return (
    <span className="folder-pick" ref={wrap}>
    <MoreMenu
      heading="Recent folders"
      trigger={{
        className: "pick folder",
        label: `Folder: ${draft.cwd}`,
        content: (
          <>
            <Icon name="folder" size={15} />
            <span>{draft.cwd ? shortFolder(draft.cwd) : "Choose a folder"}</span>
            <Icon name="chev" size={14} />
          </>
        ),
      }}
      items={[
        ...folders.map((f) => ({
          label: shortFolder(f),
          title: f,
          checked: f === draft.cwd,
          mono: true,
          onSelect: () => draft.onFolder(f),
        })),
        {
          label: "Choose another…",
          separated: true,
          onSelect: () => {
            setPath(draft.cwd);
            setTyping(true);
          },
        },
      ]}
    />
    </span>
  );
}

/**
 * A command run as a picker: choosing a value sends `/name value` as an
 * ordinary prompt, which is how every command runs. Values are fetched from
 * the agent when the picker mounts and again when it is opened; the one the
 * agent marks current is shown selected, so the row reads like a setting.
 */
function CommandPicker({
  command,
  options,
  onOpen,
  onChoose,
}: {
  command: SlashCommand;
  options: CommandOption[] | undefined;
  onOpen: () => void;
  onChoose: (value: string) => void;
}) {
  const asked = useRef(false);
  useEffect(() => {
    if (options || asked.current) return;
    asked.current = true;
    onOpen();
  }, [options, onOpen]);
  // The agent's answer lags the click by a turn; show the choice at once.
  const [chosen, setChosen] = useState<string | null>(null);
  const current = chosen ?? options?.find((o) => o.current)?.value ?? "";
  return (
    <label className="pick" title={`${command.description} (/${command.name})`}>
      <span className="pick-label">{command.name.charAt(0).toUpperCase() + command.name.slice(1)}:</span>
      <select
        aria-label={command.name}
        value={current}
        onFocus={onOpen}
        onChange={(e) => {
          if (!e.target.value) return;
          setChosen(e.target.value);
          onChoose(e.target.value);
        }}
      >
        {!options && <option value="">…</option>}
        {options && !current && <option value="">choose…</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value} title={o.description}>
            {o.label || o.value}
          </option>
        ))}
      </select>
      <Icon name="chev" size={14} />
    </label>
  );
}

/**
 * One agent-advertised setting, rendered from whatever the agent offers.
 * Never a hardcoded model list — see invariant 5 in AGENTS.md.
 */
/**
 * Provider first, before whatever that provider advertises. Only providers
 * whose check passed are offered (invariant 11); the current one is shown
 * even if it has since gone stale, since that is where the conversation is.
 * Disabled mid-turn: a switch would abandon what is in flight, and the
 * server refuses it anyway.
 */
function ProviderPicker({
  session,
  busy,
  onSwitch,
}: {
  session: SessionSummary;
  busy: boolean;
  onSwitch: (providerId: string) => void;
}) {
  const ready = useReadyProviders().providers ?? [];
  const choices = ready.some((p) => p.id === session.providerId)
    ? ready
    : [{ id: session.providerId, name: session.providerName }, ...ready];
  // Still shown with one agent, as a label: the row says who you are talking to.
  if (choices.length < 2) return <span className="pick static">{session.providerName}</span>;
  const pending = session.awaitingInput || session.queued.length > 0;
  return (
    <label
      className="pick"
      title={
        busy || pending
          ? "Wait for the turn to finish before switching"
          : "Move this conversation to another agent. It is given the transcript so far with your next message."
      }
    >
      <select
        aria-label="Agent"
        value={session.providerId}
        disabled={busy || pending}
        onChange={(e) => onSwitch(e.target.value)}
      >
        {choices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Icon name="chev" size={14} />
    </label>
  );
}

function ConfigPicker({
  option,
  onChange,
}: {
  option: ConfigOption;
  onChange: (value: string | boolean) => void;
}) {
  // Include the id in the tooltip: when an agent advertises something
  // unexpected, the label alone does not say where it came from.
  const hint = `${option.name}${option.description ? ` — ${option.description}` : ""} (${option.id})`;

  if (option.type === "boolean") {
    return (
      <label className="pick toggle" title={hint}>
        <input
          type="checkbox"
          checked={Boolean(option.currentValue)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {option.name}
      </label>
    );
  }
  // A model or a mode reads as its value alone ("Opus", "Ask before edits");
  // anything else keeps its name, so "High" says what it is high for.
  const bare = option.category === "model" || option.category === "mode";
  return (
    <label className="pick" title={hint}>
      {!bare && <span className="pick-label">{option.name}:</span>}
      <select
        aria-label={option.name}
        value={String(option.currentValue)}
        onChange={(e) => onChange(e.target.value)}
      >
        {option.options?.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.name}
          </option>
        ))}
      </select>
      <Icon name="chev" size={14} />
    </label>
  );
}
