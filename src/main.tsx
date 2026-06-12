import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RecoveryScreen } from "./components/RecoveryScreen";
import "./index.css";
import { startupStatus } from "./lib/api";
import { applyPrefs, loadPrefs } from "./lib/prefs";
import { errorMessage, pushToast } from "./lib/toast";
import type { StartupStatus } from "./lib/types";

// Apply saved theme/density before first paint so there's no flash.
applyPrefs(loadPrefs());

// One client for the whole app. Everything is local SQLite via invoke(), so
// cached data is cheap to re-read; keep it fresh-ish but not chatty.
// Failed MUTATIONS surface as a toast — a write the user asked for must never
// fail silently. (Query failures stay per-screen: TableStatus/BlockStatus
// already render them, and polled queries would spam a global toast.)
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (e) => pushToast(errorMessage(e)),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Boot gate: nothing mounts (and no AppState-backed command fires) until the
// backend reports which mode it's in. A failed startup renders the recovery
// screen instead of the app — State-taking commands would panic without state.
function Boot() {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  useEffect(() => {
    startupStatus()
      .then(setStatus)
      .catch((e) => setStatus({ ok: false, error: String(e), db_path: null }));
  }, []);
  if (!status) return null; // sub-frame wait; not worth a splash
  if (!status.ok)
    return <RecoveryScreen error={status.error ?? "unknown error"} dbPath={status.db_path} />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Boot />
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
);
