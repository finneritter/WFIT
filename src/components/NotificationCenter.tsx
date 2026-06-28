// Topbar notification bell + dropdown. Lists active in-app notifications filed by
// any page/background task (currently the riven watcher). Clicking an entry marks
// all read, navigates to its screen (loading a saved riven search when present),
// and dismisses it; entries can also be cleared individually or all at once.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { keys, useNotifications } from "../hooks/queries";
import * as api from "../lib/api";
import { clsx } from "../lib/format";
import type { AppNotification } from "../lib/types";
import { Icon } from "./Icon";
import type { ScreenId } from "./Sidebar";

type NavOpts = { loadSearchId?: number };

/** Compact "5m ago" relative time. */
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationCenter({
  onNavigate,
}: {
  onNavigate: (screen: ScreenId, opts?: NavOpts) => void;
}) {
  const qc = useQueryClient();
  const { data } = useNotifications();
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.notifications });

  // Outside-click + Escape to close. Mark all read when the panel opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only on open transitions; refresh is stable
  useEffect(() => {
    if (!open) return;
    api.markNotificationsRead().then(refresh);
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activate = async (n: AppNotification) => {
    setOpen(false);
    let loadSearchId: number | undefined;
    if (n.payload) {
      try {
        const p = JSON.parse(n.payload) as { saved_search_id?: number };
        loadSearchId = p.saved_search_id;
      } catch {
        // ignore malformed payload
      }
    }
    if (n.nav_screen) onNavigate(n.nav_screen as ScreenId, { loadSearchId });
    await api.dismissNotification(n.id);
    refresh();
  };

  const dismiss = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await api.dismissNotification(id);
    refresh();
  };
  const clearAll = async () => {
    await api.clearNotifications();
    refresh();
  };

  return (
    <div className="notif" ref={wrapRef}>
      <button
        type="button"
        className={clsx("icon-btn", unread > 0 && "has-unread")}
        title="Notifications"
        aria-label={unread > 0 ? `Notifications (${unread} new)` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {unread > 0 ? <span className="notif-badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="notif-menu">
          <div className="notif-head">
            <span>Notifications</span>
            {items.length > 0 ? (
              <button type="button" className="notif-clear" onClick={clearAll}>
                Clear all
              </button>
            ) : null}
          </div>
          <div className="notif-list">
            {items.length === 0 ? (
              <div className="notif-empty">You're all caught up.</div>
            ) : (
              items.map((n) => (
                <div key={n.id} className={clsx("notif-item", !n.read_at && "unread")}>
                  <button type="button" className="ni-main" onClick={() => activate(n)}>
                    <div className="ni-title">{n.title}</div>
                    {n.body ? <div className="ni-body">{n.body}</div> : null}
                    <div className="ni-time muted">{ago(n.created_at)}</div>
                  </button>
                  <button
                    type="button"
                    className="ni-x"
                    title="Clear"
                    onClick={(e) => dismiss(e, n.id)}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
