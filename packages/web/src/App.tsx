import type { StartOptions } from "@corella/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons.js";
import { Chat } from "./Chat.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import type { AdoptTarget } from "./AgentConversations.js";
import { Rooms, RoomView } from "./Rooms.js";
import { ScheduleLog, Schedules } from "./Schedules.js";
import { Setup } from "./Setup.js";
import { Sidebar, type SidebarApi } from "./Sidebar.js";
import { useShortcuts } from "./useShortcuts.js";

type View =
  | { name: "setup" }
  | { name: "schedules" }
  | { name: "schedule"; scheduleId: string }
  | { name: "rooms" }
  | { name: "room"; roomId: string }
  /** A new chat; `n` makes each one a fresh start. */
  | { name: "new"; n: number }
  | {
      name: "chat";
      /** Set when it began as new chat `n`: it is the same screen, not a new one. */
      fromDraft?: number;
      providerId?: string;
      cwd?: string;
      /** Settings and an opening message for a session being started. */
      start?: StartOptions;
      sessionId?: string;
      /** Set when taking over a conversation the agent already had. */
      adopt?: AdoptTarget;
      /** Opened from a schedule's log, which is where "back" goes. */
      scheduleId?: string;
      /** Opened from a room, likewise. */
      roomId?: string;
    };

/**
 * App shell: a persistent sidebar of conversations beside one main view.
 * It opens on a new chat, ready to type. Settings is a page you visit.
 */
export function App() {
  const [view, setView] = useState<View>({ name: "new", n: 0 });
  const drafts = useRef(0);
  // On a narrow screen the sidebar is a list that slides over the page.
  // Going anywhere closes it.
  // Open, it behaves as a dialog: focus moves into it, the page behind is
  // inert, and Escape closes it and puts focus back on the key that opened it.
  const [listOpen, setListOpen] = useState(false);
  const listOpener = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const showList = useCallback(() => {
    listOpener.current = document.activeElement as HTMLElement | null;
    setListOpen(true);
  }, []);
  const returnFocus = useRef(false);
  const closeList = useCallback(() => {
    returnFocus.current = true;
    setListOpen(false);
  }, []);
  useEffect(() => setListOpen(false), [view]);
  useEffect(() => {
    if (mainRef.current) mainRef.current.inert = listOpen;
    if (!listOpen) {
      // Only once the page is no longer inert can it take focus back.
      if (returnFocus.current) listOpener.current?.focus();
      returnFocus.current = false;
      return;
    }
    document.querySelector<HTMLElement>(".sidebar button")?.focus();
    // Widened past the narrow layout while open: there is no list to close.
    const wide = window.matchMedia("(min-width: 861px)");
    const onWide = () => wide.matches && setListOpen(false);
    wide.addEventListener("change", onWide);
    return () => wide.removeEventListener("change", onWide);
  }, [listOpen]);
  const listOpenRef = useRef(listOpen);
  listOpenRef.current = listOpen;
  const newChat = useCallback(() => setView({ name: "new", n: ++drafts.current }), []);
  // Bumped whenever a chat starts, so the sidebar refetches its list.
  const [listVersion, setListVersion] = useState(0);

  const openSession = useCallback((sessionId: string) => setView({ name: "chat", sessionId }), []);
  const refreshList = useCallback(() => setListVersion((v) => v + 1), []);

  // The sidebar owns the conversation list, so it exposes the two things
  // shortcuts need rather than the list being lifted up here.
  const sidebarApi = useRef<SidebarApi>(null);

  const shortcuts = useMemo(
    () => ({
      onNewChat: newChat,
      onFocusSearch: () => sidebarApi.current?.focusSearch(),
      onNextSession: (delta: number) => sidebarApi.current?.step(delta),
      onEscape: () =>
        listOpenRef.current
          ? closeList()
          : setView((v) => (v.name === "chat" || v.name === "new" ? v : { name: "new", n: ++drafts.current })),
    }),
    [newChat, closeList],
  );
  useShortcuts(shortcuts);

  // A conversation opened from a schedule's log or a room goes back there.
  const backTo = view.name === "chat" ? { scheduleId: view.scheduleId, roomId: view.roomId } : {};
  const chatBack = backTo.scheduleId
    ? () => setView({ name: "schedule", scheduleId: backTo.scheduleId as string })
    : backTo.roomId
      ? () => setView({ name: "room", roomId: backTo.roomId as string })
      : undefined;

  return (
    <div className={`shell ${listOpen ? "list-open" : ""}`}>
      <Sidebar
        api={sidebarApi}
        listVersion={listVersion}
        activeSessionId={view.name === "chat" ? view.sessionId : undefined}
        onNewChat={newChat}
        onAdopt={(providerId, adopt) => setView({ name: "chat", providerId, adopt })}
        onOpenSession={openSession}
        onOpenSetup={() => setView({ name: "setup" })}
        setupActive={view.name === "setup"}
        onOpenSchedules={() => setView({ name: "schedules" })}
        schedulesActive={view.name === "schedules"}
        onOpenSchedule={(scheduleId) => setView({ name: "schedule", scheduleId })}
        activeScheduleId={view.name === "schedule" ? view.scheduleId : view.name === "chat" ? view.scheduleId : undefined}
        onOpenRooms={() => setView({ name: "rooms" })}
        roomsActive={view.name === "rooms"}
        onOpenRoom={(roomId) => setView({ name: "room", roomId })}
        activeRoomId={view.name === "room" ? view.roomId : view.name === "chat" ? view.roomId : undefined}
      />

      {listOpen && <button className="scrim" aria-label="Close the list" onClick={closeList} />}
      <main className="main" ref={mainRef}>
        {view.name !== "chat" && view.name !== "new" && (
          <button className="plain narrow-only list-back" onClick={showList}>
            <Icon name="back" />
            Chats
          </button>
        )}
        {/* Keyed per view, so an error is not carried to the next one. A new
            chat keeps its key once it begins: remounting there would close
            the socket its first message went out on. */}
        <ErrorBoundary
          key={view.name === "new" ? `new-${view.n}` : view.name === "chat" && view.fromDraft !== undefined ? `new-${view.fromDraft}` : JSON.stringify(view)}
        >

        {view.name === "setup" && <Setup />}
        {view.name === "schedules" && (
          <Schedules
            onOpenSession={openSession}
            onOpenSchedule={(scheduleId) => setView({ name: "schedule", scheduleId })}
          />
        )}
        {view.name === "rooms" && <Rooms onOpenRoom={(roomId) => setView({ name: "room", roomId })} />}
        {view.name === "room" && (
          <RoomView
            roomId={view.roomId}
            onOpenSession={(sessionId) => setView({ name: "chat", sessionId, roomId: view.roomId })}
            onBack={() => setView({ name: "rooms" })}
          />
        )}
        {view.name === "schedule" && (
          <ScheduleLog
            scheduleId={view.scheduleId}
            onOpenSession={(sessionId) => setView({ name: "chat", sessionId, scheduleId: view.scheduleId })}
            onBack={() => setView({ name: "schedules" })}
          />
        )}

        {(view.name === "chat" || view.name === "new") && (
          <Chat
            draft={view.name === "new"}
            onShowList={showList}
            onBegan={(sessionId) =>
              setView((v) => (v.name === "new" ? { name: "chat", sessionId, fromDraft: v.n } : v))
            }
            providerId={view.name === "chat" ? view.providerId : undefined}
            cwd={view.name === "chat" ? view.cwd : undefined}
            start={view.name === "chat" ? view.start : undefined}
            sessionId={view.name === "chat" ? view.sessionId : undefined}
            adopt={view.name === "chat" ? view.adopt : undefined}
            onStarted={refreshList}
            onOpenSetup={() => setView({ name: "setup" })}
            onBack={chatBack}
            onPlay={() => sidebarApi.current?.play()}
          />
        )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
