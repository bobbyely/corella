import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { ResizeHandle } from "./ResizeHandle.js";
import { AgentConversationsSection, type AdoptTarget } from "./AgentConversations.js";
import type { RoomView, ScheduleRun, ScheduleView, SessionSummary } from "@corella/shared";
import { fetchRooms, fetchSchedules } from "./api.js";
import { GamesPanel } from "./games/Games.js";
import { CueMark, Icon } from "./icons.js";
import { useChat } from "./useChat.js";
import { sameDay, shortAge } from "./when.js";

const WIDTH_KEY = "kc.sidebar.width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 300;
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, MIN_WIDTH), MAX_WIDTH));

function loadWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return clampWidth(stored > 0 ? stored : DEFAULT_WIDTH);
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** The keys printed on New chat and Search, as this platform spells them. */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const NEW_CHAT_KEYS = IS_MAC ? "⌘⇧O" : "Ctrl⇧O";
const SEARCH_KEYS = IS_MAC ? "⌘K" : "Ctrl K";

/** Persistent left rail: new chat, past conversations, Schedules, Rooms, Settings, and the games. */
export interface SidebarApi {
  focusSearch: () => void;
  step: (delta: number) => void;
  /** Opens the word games: the chat's ··· menu asks for them through here. */
  play: () => void;
}

export function Sidebar({
  api,
  listVersion,
  activeSessionId,
  onNewChat,
  onOpenSession,
  onOpenSetup,
  setupActive,
  onOpenSchedules,
  schedulesActive,
  onOpenSchedule,
  activeScheduleId,
  onOpenRooms,
  roomsActive,
  onOpenRoom,
  activeRoomId,
  onAdopt,
}: {
  api: RefObject<SidebarApi | null>;
  listVersion: number;
  activeSessionId?: string | undefined;
  onNewChat: () => void;
  onOpenSession: (id: string) => void;
  onOpenSetup: () => void;
  setupActive: boolean;
  onOpenSchedules: () => void;
  schedulesActive: boolean;
  onOpenSchedule: (id: string) => void;
  activeScheduleId?: string | undefined;
  onOpenRooms: () => void;
  roomsActive: boolean;
  onOpenRoom: (id: string) => void;
  activeRoomId?: string | undefined;
  /** Opens a conversation started in the agent's own CLI, found under Search. */
  onAdopt: (providerId: string, target: AdoptTarget) => void;
}) {
  const { connected, sessions, listSessions, renameSession, archiveSession, search, searchHits } =
    useChat();
  const [renaming, setRenaming] = useState<string | null>(null);
  // The games live here rather than in Chat because this rail is on every
  // screen, and it already knows which conversation is waiting on the user.
  // They are positioned fixed, so where they render makes no visual difference.
  const [playing, setPlaying] = useState(false);
  const awaitingInput = sessions?.some((s) => s.awaitingInput) ?? false;

  // Drag the right edge to resize. The width is a per-browser convenience,
  // like the theme, and the shell reads it from a CSS variable.
  const [width, setWidth] = useState(loadWidth);
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  }, [width]);
  const keepWidth = () =>
    setWidth((w) => {
      try {
        localStorage.setItem(WIDTH_KEY, String(w));
      } catch {
        // Then it is simply not remembered.
      }
      return w;
    });
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);

  useImperativeHandle(api, () => ({
    play: () => setPlaying(true),
    focusSearch: () => searchInput.current?.select(),
    step: (delta: number) => {
      if (!sessions || sessions.length === 0) return;
      const current = sessions.findIndex((s) => s.id === activeSessionId);
      // From nowhere, Down starts at the top and Up at the bottom.
      const next = current === -1 ? (delta > 0 ? 0 : sessions.length - 1) : current + delta;
      const wrapped = (next + sessions.length) % sessions.length;
      onOpenSession(sessions[wrapped]!.id);
    },
  }));

  useEffect(() => {
    if (connected) listSessions(showArchived);
  }, [connected, listSessions, listVersion, showArchived]);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => search(query), 180);
    return () => window.clearTimeout(id);
  }, [query, search]);

  const searching = query.trim().length > 0;

  // A schedule's runs are one conversation each, and forty-eight a day of the
  // same prompt would bury the ones you typed. The sidebar lists the schedule
  // instead, once; its runs are on its own page.
  const own = (sessions ?? []).filter((s) => !s.scheduleId && !s.roomId);
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [rooms, setRooms] = useState<RoomView[]>([]);
  // Refetched when the session list changes, which a run ending or a room
  // turn always does.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSchedules(), fetchRooms()])
      .then(([s, r]) => {
        if (cancelled) return;
        setSchedules(s.schedules);
        setRooms(r.rooms);
      })
      .catch(() => {
        // The lists are decoration here; their pages report the error.
      });
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  // Re-read once a minute, so "now" becomes "1 min" without a new list.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = own.filter((s) => s.updatedAt === undefined || sameDay(s.updatedAt, now));
  const earlier = own.filter((s) => s.updatedAt !== undefined && !sameDay(s.updatedAt, now));

  const renderItem = (session: SessionSummary) =>
    renaming === session.id ? (
      <RenameField
        key={session.id}
        session={session}
        onCommit={(title) => {
          if (title.trim()) renameSession(session.id, title);
          setRenaming(null);
        }}
        onCancel={() => setRenaming(null)}
      />
    ) : (
      <div
        key={session.id}
        className={`sidebar-item state-${chatState(session)} ${session.id === activeSessionId ? "active" : ""} ${
          session.archived ? "archived" : ""
        }`}
      >
        <button
          className="sidebar-item-main"
          onClick={() => onOpenSession(session.id)}
          onDoubleClick={() => setRenaming(session.id)}
          title={session.title ?? "Untitled"}
          aria-current={session.id === activeSessionId ? "page" : undefined}
        >
          <span className="sidebar-mark">
            <StateTag state={chatState(session)} />
          </span>
          <span className="sidebar-item-title">{session.title ?? "Untitled"}</span>
          <span className="sidebar-item-time">{session.updatedAt !== undefined ? shortAge(session.updatedAt, now) : ""}</span>
          <span className="sidebar-item-sub">{STATE_NOTE[chatState(session)] ?? session.providerName}</span>
        </button>
        <span className="sidebar-actions">
          <button
            className="sidebar-action"
            title="Rename"
            aria-label={`Rename ${session.title ?? "conversation"}`}
            onClick={() => setRenaming(session.id)}
          >
            <Icon name="edit" size={14} />
          </button>
          <button
            className="sidebar-action"
            title={session.archived ? "Restore" : "Archive"}
            aria-label={`${session.archived ? "Restore" : "Archive"} ${session.title ?? "conversation"}`}
            onClick={() => archiveSession(session.id, !session.archived)}
          >
            <Icon name={session.archived ? "back" : "archive"} size={14} />
          </button>
        </span>
      </div>
    );

  return (
    <aside className="sidebar">
      <ResizeHandle
        className="sidebar-resize"
        label="Sidebar width"
        width={width}
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        grow={1}
        fromPointer={(x) => x}
        onChange={(w) => setWidth(clampWidth(w))}
        onCommit={keepWidth}
      />
      <div className="sidebar-head">
        <span className="brand">Corella</span>
      </div>

      <button className="hw wide new-chat" onClick={onNewChat}>
        <Icon name="plus" />
        New chat
        <kbd aria-label={`Shortcut ${NEW_CHAT_KEYS}`}>{NEW_CHAT_KEYS}</kbd>
      </button>

      <label className="sidebar-search">
        <Icon name="search" />
        <input
          ref={searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search conversations"
        />
        {searching ? (
          <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">
            <Icon name="cross" size={14} />
          </button>
        ) : (
          <kbd>{SEARCH_KEYS}</kbd>
        )}
      </label>

      {searching ? (
        <nav className="sidebar-list" aria-label="Search results">
          {searchHits?.length === 0 && <p className="sidebar-empty">No matches.</p>}
          {searchHits?.map((hit) => (
            <button key={hit.sessionId} className="search-hit" onClick={() => onOpenSession(hit.sessionId)}>
              <span className="sidebar-item-title">{hit.title ?? "Untitled"}</span>
              <Snippet text={hit.snippet} />
            </button>
          ))}
          <AgentConversationsSection query={query} onAdopt={onAdopt} onOpenSession={onOpenSession} />
        </nav>
      ) : (
      <nav className="sidebar-list" aria-label="Chats">
        <h2 className="rule-label">{showArchived ? "Archived and today" : "Today"}</h2>
        {today.length === 0 && (
          <p className="sidebar-empty">{own.length === 0 ? (showArchived ? "Nothing here." : "No chats yet.") : "Nothing yet today."}</p>
        )}
        {today.map(renderItem)}
        {earlier.length > 0 && (
          <>
            <h2 className="rule-label">Earlier</h2>
            {earlier.map(renderItem)}
          </>
        )}
        {/* Rooms and schedules fold, so a long list of one does not push the
            others off the bottom; the list as a whole scrolls. */}
        {rooms.length > 0 && (
          <details className="sidebar-group" open>
            <summary className="rule-label">Rooms</summary>
            {rooms.map((room) => (
              <div key={room.id} className={`sidebar-item ${room.id === activeRoomId ? "active" : ""}`}>
                <button className="sidebar-item-main" onClick={() => onOpenRoom(room.id)} title={room.topic}>
                  <span className="sidebar-mark">
                    <StateTag state={room.status === "running" ? "onair" : room.status === "held" ? "cue" : "ready"} />
                  </span>
                  <span className="sidebar-item-title">{room.name}</span>
                  <span className="sidebar-item-sub">{room.participants.map((p) => p.name).join(", ")}</span>
                </button>
              </div>
            ))}
          </details>
        )}
        {schedules.length > 0 && (
          <details className="sidebar-group" open>
            <summary className="rule-label">Schedules</summary>
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className={`sidebar-item ${schedule.id === activeScheduleId ? "active" : ""}`}
              >
                <button className="sidebar-item-main" onClick={() => onOpenSchedule(schedule.id)} title={schedule.name}>
                  <span className="sidebar-mark">
                    <StateTag state={runState(schedule.runs[0])} />
                  </span>
                  <span className="sidebar-item-title">{schedule.name}</span>
                  <span className="sidebar-item-sub">
                    {schedule.runs.length} run{schedule.runs.length === 1 ? "" : "s"}
                    {schedule.status === "paused" && " · paused"}
                  </span>
                </button>
              </div>
            ))}
          </details>
        )}
        <button
          className={`archived-toggle ${showArchived ? "active" : ""}`}
          onClick={() => setShowArchived((v) => !v)}
          aria-pressed={showArchived}
          title="Archived chats are hidden from this list"
        >
          {showArchived ? "Hide archived chats" : "Show archived chats"}
        </button>
      </nav>
      )}

      <div className="sidebar-foot">
        <button className={`foot-link ${schedulesActive ? "active" : ""}`} onClick={onOpenSchedules} aria-current={schedulesActive ? "page" : undefined}>
          <Icon name="clock" />
          Schedules
        </button>
        <button className={`foot-link ${roomsActive ? "active" : ""}`} onClick={onOpenRooms} aria-current={roomsActive ? "page" : undefined}>
          <Icon name="rooms" />
          Rooms
        </button>
        <button className={`foot-link ${setupActive ? "active" : ""}`} onClick={onOpenSetup} aria-current={setupActive ? "page" : undefined}>
          <Icon name="gear" />
          Settings
        </button>
        <span
          className={`dot ${connected ? "dot-ok" : "dot-off"}`}
          role="img"
          aria-label={connected ? "Connected" : "Reconnecting"}
          title={connected ? "Connected to the Corella server" : "Reconnecting to the Corella server…"}
        />
      </div>
      {/* Opened from the chat's ··· menu, not a floating button: one that
          floats over the chat can cover a permission prompt's keys. */}
      <GamesPanel
        open={playing}
        awaitingInput={awaitingInput}
        onClose={() => setPlaying(false)}
      />
    </aside>
  );
}

type TagState = "cue" | "onair" | "new" | "off" | "failed" | "ready";

/**
 * A chat's state, in order of urgency: blocked on you beats busy, busy beats
 * an unread reply, and "no agent attached" is the quietest mark. Ready has none.
 */
function chatState(session: SessionSummary): TagState {
  if (session.awaitingInput) return "cue";
  if (session.busy) return "onair";
  if (session.unread) return "new";
  if (!session.live) return "off";
  return "ready";
}

/** A schedule's state is its latest run's. */
function runState(run: ScheduleRun | undefined): TagState {
  if (!run) return "off";
  if (run.outcome === "running") return "onair";
  if (run.unread) return "new";
  if (run.outcome === "failed") return "failed";
  return "ready";
}

/** The second line of a chat row, when its state says more than the agent's name. */
const STATE_NOTE: Partial<Record<TagState, string>> = {
  cue: "Waiting for your answer",
  onair: "Working",
  off: "No agent attached",
};

const TAG_TITLE: Record<Exclude<TagState, "ready">, string> = {
  cue: "Cue: the agent is waiting for your answer",
  onair: "On air: the agent is working",
  new: "New: a reply you have not opened yet",
  off: "Off: no agent attached. Open it and resume to continue",
  failed: "Failed: the last run did not finish",
};

/** The state as a word and a shape, never colour alone, with a tooltip saying what it means. */
function StateTag({ state }: { state: TagState }) {
  if (state === "ready") return null;
  const title = TAG_TITLE[state];
  switch (state) {
    case "cue":
      return (
        <span className="tag cue" title={title} aria-label={title}>
          <CueMark />
          Cue
        </span>
      );
    case "onair":
      return (
        <span className="tag onair" title={title} aria-label={title}>
          <i className="lamp" />
          On air
        </span>
      );
    case "new":
      return <span className="tag new" title={title} aria-label={title}>New</span>;
    case "off":
      return <span className="tag off" title={title} aria-label={title}>Off</span>;
    case "failed":
      return (
        <span className="tag failed" title={title} aria-label={title}>
          <Icon name="cross" size={11} />
          Failed
        </span>
      );
  }
}

/**
 * Renders a search snippet, highlighting the matched terms.
 *
 * SQLite marks matches with \u0002 and \u0003 rather than HTML, so the text is
 * split on those and rendered as elements — no dangerouslySetInnerHTML, and no
 * way for conversation text to inject markup.
 */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/\u0002|\u0003/);
  return (
    <span className="search-snippet">
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </span>
  );
}

function RenameField({
  session,
  onCommit,
  onCancel,
}: {
  session: SessionSummary;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(session.title ?? "");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.select();
  }, []);

  return (
    <input
      ref={input}
      className="sidebar-rename-input"
      value={value}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
