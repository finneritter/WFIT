import { useSyncExternalStore } from "react";
import { clsx } from "../lib/format";
import { dismissToast, getToasts, subscribeToasts } from "../lib/toast";

/** Fixed bottom-right stack of dismissible toasts; rendered once in App. */
export function Toasts() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={clsx("toast", t.kind === "error" && "toast-err")}
          onClick={() => dismissToast(t.id)}
          title="Dismiss"
        >
          <span className="toast-k">{t.kind === "error" ? "ERROR" : "INFO"}</span>
          <span className="toast-m">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
