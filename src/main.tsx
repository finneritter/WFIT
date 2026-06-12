import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { applyPrefs, loadPrefs } from "./lib/prefs";
import { errorMessage, pushToast } from "./lib/toast";

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
);
