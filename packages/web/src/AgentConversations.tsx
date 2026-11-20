// "Conversations your agent already has", shown under Search in the sidebar:
// conversations started in an agent's own CLI, listed by the agent through
// ACP's `session/list` and opened here by adopting them. Rendered by
// Sidebar.tsx for each agent that advertised listing; fetches on demand.
import { useMemo, useState } from "react";
import type { AgentSessionInfo, AgentSessionsResponse, KcError, ProviderView } from "@corella/shared";
import { advertisesLoadSession, advertisesSessionList } from "@corella/shared";
import { ApiError, fetchAgentSessions } from "./api.js";
import { useReadyProviders } from "./useReadyProviders.js";

/** What the parent needs to open a conversation the agent owns. */
export interface AdoptTarget {
  agentSessionId: string;
  cwd: string;
  title: string | null;
}

/**
 * Every ready agent that can list its own conversations, filtered by what is
 * typed in Search. Listing is read from the capabilities its check recorded,
 * so nothing here assumes which agents can do this.
 */
export function AgentConversationsSection({
  query,
  onAdopt,
  onOpenSession,
}: {
  query: string;
  onAdopt: (providerId: string, target: AdoptTarget) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const ready = useReadyProviders().providers;
  const listers = useMemo(
    () => (ready ?? []).filter((p) => advertisesSessionList(p.lastCheck?.capabilities)),
    [ready],
  );
  if (listers.length === 0) return null;
  return (
    <section className="agent-conversations" aria-label="Conversations your agent already has">
      <h2 className="rule-label">In your agents</h2>
      <p className="sidebar-empty">Started in the agent&rsquo;s own CLI. Opening one continues it here.</p>
      {listers.map((provider) => (
        <AgentConversations
          key={provider.id}
          provider={provider}
          query={query}
          onAdopt={onAdopt}
          onOpenSession={onOpenSession}
        />
      ))}
    </section>
  );
}

/**
 * One provider's own conversations, fetched on demand.
 *
 * On demand because listing spawns a probe agent on the server: doing it for
 * every verified provider on arrival would make the page cost several agent
 * startups before the user has asked for anything.
 *
 * Only rendered for providers that advertised `sessionCapabilities.list`, read
 * from the capabilities their setup check recorded — nothing here assumes which
 * agents can do this.
 */
function AgentConversations({
  provider,
  query,
  onAdopt,
  onOpenSession,
}: {
  provider: ProviderView;
  query: string;
  onAdopt: (providerId: string, target: AdoptTarget) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [listed, setListed] = useState<AgentSessionsResponse | null>(null);
  const [error, setError] = useState<KcError | null>(null);

  // Listing is gated on `sessionCapabilities.list`; opening one is gated on the
  // separate top-level `loadSession`. An agent can advertise the first without
  // the second, and then the list is worth showing but not clickable.
  const canOpen = advertisesLoadSession(provider.lastCheck?.capabilities);

  const load = () => {
    setState("loading");
    setError(null);
    fetchAgentSessions(provider.id)
      .then((res) => {
        setListed(res);
        setState("done");
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.kc : { code: "INTERNAL", message: String(err) },
        );
        setState("done");
      });
  };

  if (state === "idle") {
    return (
      <button className="chip" onClick={load}>
        Browse {provider.name}&rsquo;s conversations
      </button>
    );
  }
  if (state === "loading") {
    return <p className="muted">Asking {provider.name} what it has…</p>;
  }
  if (error) {
    return (
      <div className="banner">
        {error.message}
        {error.remediation && <p className="remediation">{error.remediation}</p>}
      </div>
    );
  }
  const words = query.trim().toLowerCase();
  const shown = (listed?.sessions ?? []).filter(
    (info) => !words || `${info.title ?? ""} ${info.cwd}`.toLowerCase().includes(words),
  );
  if (listed && listed.sessions.length > 0 && shown.length === 0) {
    return <p className="sidebar-empty">Nothing in {provider.name}&rsquo;s own list matches.</p>;
  }
  if (!listed || listed.sessions.length === 0) {
    return (
      <p className="muted">
        {listed?.supported === false
          ? `${provider.name} no longer offers session/list.`
          : `${provider.name} is not holding any conversations.`}
      </p>
    );
  }

  return (
    <div className="agent-sessions">
      {shown.map((info) => (
        <AgentConversationRow
          key={info.sessionId}
          info={info}
          canOpen={canOpen}
          heldBy={listed.adopted[info.sessionId]}
          onAdopt={() =>
            onAdopt(provider.id, {
              agentSessionId: info.sessionId,
              cwd: info.cwd,
              title: info.title,
            })
          }
          onOpenSession={onOpenSession}
        />
      ))}
      {listed.truncated && (
        <p className="muted">
          Only the most recent are shown; {provider.name} reported more than we fetch at once.
        </p>
      )}
    </div>
  );
}

function AgentConversationRow({
  info,
  canOpen,
  heldBy,
  onAdopt,
  onOpenSession,
}: {
  info: AgentSessionInfo;
  canOpen: boolean;
  /** Set when this agent session is already a Corella conversation. */
  heldBy: string | undefined;
  onAdopt: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const label = info.title ?? info.sessionId;
  const when = info.updatedAt ? new Date(info.updatedAt).toLocaleString() : null;

  return (
    <button
      className="agent-session"
      disabled={!canOpen && heldBy === undefined}
      onClick={() => (heldBy !== undefined ? onOpenSession(heldBy) : onAdopt())}
    >
      <strong>{label}</strong>
      <span className="muted">{info.cwd}</span>
      <span className="muted">
        {heldBy !== undefined ? "Already open here" : when ?? "No date reported"}
      </span>
    </button>
  );
}
