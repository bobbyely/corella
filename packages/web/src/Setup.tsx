import { useCallback, useEffect, useState } from "react";
import { CHECK_STAGES } from "@corella/shared";
import type { CheckStage, HostPlatform, KcError, ProviderCheckResult, ProviderView } from "@corella/shared";
import { ApiError, fetchProviders, runCheck, updateProvider } from "./api.js";
import { cardStatus, isReady } from "./providerStatus.js";
import { applyTheme, loadTheme, resolveTheme, THEMES, type Theme } from "./theme.js";

export function Setup() {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [platform, setPlatform] = useState<HostPlatform>("other");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  /**
   * A check whose *request* failed — the server refused it, or was unreachable —
   * as opposed to a check that ran and reported a failing rung. Kept per
   * provider: the last result is still the last known result, but the card must
   * not present it as current when the attempt to refresh it never ran.
   */
  const [checkErrors, setCheckErrors] = useState<Record<string, KcError>>({});

  const load = useCallback(async () => {
    try {
      const { providers, platform } = await fetchProviders();
      setProviders(providers);
      setPlatform(platform);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.kc.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Agents are checked automatically; ask again until those checks are done.
  const autoChecking = providers?.some((p) => p.checking) ?? false;
  useEffect(() => {
    if (!autoChecking) return;
    const id = window.setTimeout(() => void load(), 1_000);
    return () => window.clearTimeout(id);
  }, [autoChecking, providers, load]);

  const check = useCallback(async (id: string) => {
    setRunning((prev) => new Set(prev).add(id));
    setCheckErrors((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    try {
      const { result } = await runCheck(id);
      setProviders((prev) =>
        prev?.map((p) => (p.id === id ? { ...p, lastCheck: result } : p)) ?? prev,
      );
    } catch (err) {
      const error: KcError =
        err instanceof ApiError ? err.kc : { code: "INTERNAL", message: String(err) };
      setCheckErrors((prev) => ({ ...prev, [id]: error }));
    } finally {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const ready = providers?.filter((p) => isReady(checkErrors[p.id] ?? null, p.lastCheck)).length ?? 0;

  return (
    <div className="page">
      <header className="header">
        <h1>Settings</h1>
        <p className="subtitle">
          Each agent is checked when Corella starts and when its command changes, and must pass
          every rung before a new chat can use it. Check again here to see why one fails.
        </p>
        {providers && (
          <p className="tally">
            {ready} of {providers.length} provider{providers.length === 1 ? "" : "s"} ready
          </p>
        )}
      </header>

      {loadError && <div className="banner">{loadError}</div>}

      <ThemePicker />
      <Shortcuts />

      <h2 className="section-label rule-label agents-label">Agents</h2>
      {!providers && !loadError && <p className="muted">Loading providers…</p>}

      <div className="cards">
        {providers?.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            running={running.has(provider.id) || provider.checking === true}
            checkError={checkErrors[provider.id] ?? null}
            platform={platform}
            onCheck={() => void check(provider.id)}
            onReload={load}
          />
        ))}
      </div>
    </div>
  );
}

const THEME_CHOICES: Array<{ id: Theme; name: string; note: string }> = [
  ...THEMES,
  { id: "system", name: "System", note: "Cream or Studio, following your computer's light or dark setting." },
];

/**
 * One radio per theme, each with a swatch of its own ground, text and lamp.
 * The swatch carries `data-theme`, so it shows the theme's real tokens rather
 * than a second copy of them.
 */
function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  const choose = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  return (
    <section className="theme">
      <h2 className="section-label rule-label">Appearance</h2>
      <div className="theme-choices" role="radiogroup" aria-label="Theme">
        {THEME_CHOICES.map((choice) => (
          <label key={choice.id} className={`theme-choice ${theme === choice.id ? "on" : ""}`}>
            <input
              type="radio"
              name="theme"
              value={choice.id}
              checked={theme === choice.id}
              onChange={() => choose(choice.id)}
            />
            <span className="theme-swatch" data-theme={resolveTheme(choice.id)} aria-hidden="true">
              <i />
              <i />
            </span>
            <span className="theme-name">{choice.name}</span>
            <span className="theme-note">{choice.note}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

/**
 * Codes where the fix is to change the command: either the binary was not
 * found, or it was found and never became an ACP server in time — which an
 * `npx` wrapper causes on its own, by re-resolving the package on every spawn.
 * Both are answered by installing the agent and pointing at its binary.
 */
const COMMAND_FIXABLE = new Set(["AGENT_NOT_FOUND", "AGENT_SPAWN_FAILED", "AGENT_HANDSHAKE_TIMEOUT"]);

/**
 * How to install the agent, and a field to point at it directly.
 *
 * GUI-launched processes often do not inherit a shell PATH, so an absolute
 * path is frequently the actual fix rather than installing anything.
 */
function CommandHelp({
  provider,
  platform,
  onReload,
}: {
  provider: ProviderView;
  platform: HostPlatform;
  onReload: () => Promise<void>;
}) {
  const [path, setPath] = useState(provider.command);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The hint travels with the provider, so an agent added to config.json can
  // carry its own. No branching on provider id here — see invariant 5.
  const hint = provider.install?.[platform];

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateProvider(provider.id, { command: path });
      await onReload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.kc.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notfound">
      {hint && (
        <>
          <p className="notfound-label">Install it</p>
          <pre className="notfound-cmd">{hint}</pre>
        </>
      )}
      {provider.docsUrl && (
        <p className="notfound-label">
          <a href={provider.docsUrl} rel="noreferrer" target="_blank">
            Docs for {provider.name}
          </a>
        </p>
      )}
      <p className="notfound-label">Or point at it directly</p>
      <div className="notfound-row">
        <input
          value={path}
          spellCheck={false}
          placeholder="/absolute/path/to/binary"
          onChange={(e) => setPath(e.target.value)}
        />
        <button onClick={() => void save()} disabled={saving || !path.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="field-hint">
        Common locations: <code>~/.local/bin/</code>, <code>/usr/local/bin/</code>,
        <code> /opt/homebrew/bin/</code>
      </p>
      {saveError && <p className="remediation">{saveError}</p>}
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["⌘/Ctrl + K", "Search conversations"],
  ["⌘/Ctrl + ⇧ + O", "New chat"],
  ["Alt + ↑ / ↓", "Previous / next conversation"],
  ["Enter", "Send · ⇧ Enter for a newline"],
];

function Shortcuts() {
  return (
    <section className="theme">
      <h2 className="section-label rule-label">Keyboard</h2>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys}>
            <dt><kbd>{keys}</kbd></dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ProviderCard({
  provider,
  running,
  checkError,
  platform,
  onCheck,
  onReload,
}: {
  provider: ProviderView;
  running: boolean;
  checkError: KcError | null;
  platform: HostPlatform;
  onCheck: () => void;
  onReload: () => Promise<void>;
}) {
  const check = provider.lastCheck;
  const status = cardStatus(running, checkError, check);

  return (
    <section className={`card status-${status}`}>
      <div className="card-head">
        <div>
          <h2>{provider.name}</h2>
          <code className="cmd">
            {provider.command} {provider.args.join(" ")}
          </code>
        </div>
        <div className="card-actions">
          <StatusPill status={status} />
          <button onClick={onCheck} disabled={running}>
            {running ? "Checking…" : check ? "Re-check" : "Check"}
          </button>

        </div>
      </div>

      {checkError && (
        <div className="error">
          <div className="error-head">
            <span className="code">{checkError.code}</span>
            <span>Could not re-check: {checkError.message}</span>
          </div>
          {checkError.remediation && <p className="remediation">{checkError.remediation}</p>}
          <Details label="Error detail" json={checkError.detail} />
          {check && (
            <p className="muted">
              The result below is from the last check that did run, and has not been re-verified.
            </p>
          )}
        </div>
      )}

      <Ladder result={check} running={running} />

      {check?.error && (
        <div className="error">
          <div className="error-head">
            <span className="code">{check.error.code}</span>
            <span>{check.error.message}</span>
          </div>
          {check.error.remediation && <p className="remediation">{check.error.remediation}</p>}
          {COMMAND_FIXABLE.has(check.error.code) && (
            <CommandHelp provider={provider} platform={platform} onReload={onReload} />
          )}
          <Details label="Error detail" json={check.error.detail} />
          {check.error.cause && <Details label="Cause" text={check.error.cause} />}
        </div>
      )}

      {check?.status === "ok" && <Capabilities result={check} />}

      {/* The agent's stdout is JSON-RPC; when it misbehaves, the reason is here. */}
      {check?.stderrTail && <Details label="Agent stderr" text={check.stderrTail} />}

      {check && (
        <p className="muted timestamp">
          Checked {new Date(check.checkedAt).toLocaleString()} · {check.durationMs}ms
        </p>
      )}
    </section>
  );
}

/** The check ladder, showing exactly which rung was reached. */
function Ladder({ result, running }: { result: ProviderCheckResult | null; running: boolean }) {
  const outcome = (stage: CheckStage) => result?.stages.find((s) => s.stage === stage);

  return (
    <ol className="ladder">
      {CHECK_STAGES.map((stage) => {
        const done = outcome(stage);
        const state = running && !done ? "pending" : !done ? "skipped" : done.ok ? "ok" : "failed";
        return (
          <li key={stage} className={`rung rung-${state}`}>
            <span className="rung-mark">{state === "ok" ? "✓" : state === "failed" ? "✗" : "·"}</span>
            <span className="rung-name">{stage}</span>
            {done && <span className="rung-ms">{done.ms}ms</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Capabilities({ result }: { result: ProviderCheckResult }) {
  return (
    <div className="ok-detail">
      <dl>
        <dt>Agent</dt>
        <dd>
          {result.agentInfo?.title ?? result.agentInfo?.name ?? "unknown"}
          {result.agentInfo?.version ? ` ${result.agentInfo.version}` : ""}
        </dd>
        <dt>Protocol</dt>
        <dd>ACP v{result.protocolVersion}</dd>
      </dl>
      <Details label="Config options (composer pickers)" json={result.configOptions} />
      <Details label="Modes" json={result.modes} />
      <Details label="Capabilities" json={result.capabilities} />
    </div>
  );
}

function Details({ label, json, text }: { label: string; json?: unknown; text?: string }) {
  const body = text ?? (json == null ? null : JSON.stringify(json, null, 2));
  if (!body) return null;
  return (
    <details className="details">
      <summary>{label}</summary>
      <pre>{body}</pre>
    </details>
  );
}

const LABELS: Record<string, string> = {
  ok: "Ready",
  failed: "Failed",
  stale: "Needs re-check",
  unverified: "Unverified",
  unchecked: "Not checked",
  running: "Checking",
};

const StatusPill = ({ status }: { status: string }) => (
  <span className={`pill pill-${status}`}>{LABELS[status] ?? status}</span>
);
