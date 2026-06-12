// Minimal global toast store (no dependency): module state + useSyncExternalStore.
// Mutations report failures here via the QueryClient's MutationCache onError
// (main.tsx) so no failed write is ever silent; screens can also push directly.

export type Toast = {
  id: number;
  kind: "error" | "info";
  message: string;
};

const DISMISS_MS = 6_000;
const MAX_VISIBLE = 4;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  toasts = toasts.filter((x) => x.id !== id);
  notify();
}

export function pushToast(message: string, kind: Toast["kind"] = "error") {
  // A repeat of a visible message refreshes its timer instead of stacking —
  // a flaky endpoint retried by React Query shouldn't fill the screen.
  const dup = toasts.find((t) => t.message === message && t.kind === kind);
  if (dup) {
    const t = timers.get(dup.id);
    if (t) clearTimeout(t);
    timers.set(
      dup.id,
      setTimeout(() => dismissToast(dup.id), DISMISS_MS),
    );
    return;
  }
  const toast: Toast = { id: nextId++, kind, message };
  toasts = [...toasts, toast].slice(-MAX_VISIBLE);
  timers.set(
    toast.id,
    setTimeout(() => dismissToast(toast.id), DISMISS_MS),
  );
  notify();
}

/** Human-readable message from an invoke() rejection (the serialized AppError). */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
