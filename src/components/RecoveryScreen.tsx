// Shown instead of the app when startup failed (corrupt DB / failed migration).
// Deliberately self-contained: no React Query, no AppState-backed commands —
// only the recovery command surface, which works without backend state.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { recoveryBackupDb, recoveryResetDb } from "../lib/api";
import { TitleBar } from "./TitleBar";

export function RecoveryScreen({ error, dbPath }: { error: string; dbPath: string | null }) {
  const [backedUpTo, setBackedUpTo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const backup = async () => {
    setBusy(true);
    setActionError(null);
    try {
      setBackedUpTo(await recoveryBackupDb());
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await recoveryResetDb(); // moves the DB aside + restarts; won't resolve
    } catch (e) {
      setActionError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="win">
      <TitleBar />
      <div className="recovery">
        <section className="tpanel recovery-panel">
          <div className="tpanel-h">
            <h3>Database failed to open</h3>
          </div>
          <div className="recovery-body">
            <p>
              WFIT couldn't start because its database failed to open or migrate. Your data file has{" "}
              <b>not</b> been changed.
            </p>
            <pre className="recovery-err">{error}</pre>
            {dbPath ? (
              <p className="muted">
                Database: <span className="num">{dbPath}</span>
              </p>
            ) : null}
            <div className="recovery-actions">
              <button type="button" className="btn pri" disabled={busy} onClick={backup}>
                {busy && !armed ? "Backing up…" : "Back up current DB file"}
              </button>
              {armed ? (
                <>
                  <button type="button" className="btn warn" disabled={busy} onClick={reset}>
                    {busy ? "Resetting…" : "Confirm reset & restart"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => setArmed(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn warn"
                  disabled={busy}
                  onClick={() => setArmed(true)}
                >
                  Reset database…
                </button>
              )}
              <button type="button" className="btn" onClick={() => getCurrentWindow().close()}>
                Quit
              </button>
            </div>
            {armed ? (
              <p className="muted">
                Reset moves the current file aside as{" "}
                <span className="num">wfit.sqlite.broken-…</span> (nothing is deleted) and restarts
                with a fresh database. Recommended: back up first.
              </p>
            ) : (
              <p className="muted">Recommended: back up first, then reset.</p>
            )}
            {backedUpTo ? <p className="recovery-ok num">Backed up to {backedUpTo}</p> : null}
            {actionError ? <p className="recovery-fail">{actionError}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
