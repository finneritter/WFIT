import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyPrefs, loadPrefs } from "./lib/prefs";

// Apply saved theme/density before first paint so there's no flash.
applyPrefs(loadPrefs());

// One client for the whole app. Everything is local SQLite via invoke(), so
// cached data is cheap to re-read; keep it fresh-ish but not chatty.
const queryClient = new QueryClient({
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
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
