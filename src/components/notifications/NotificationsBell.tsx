"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";
import {
  countUnreadDashboardNotifications,
  DASHBOARD_NOTIFICATION_READS_UPDATED_EVENT,
  markDashboardNotificationsRead,
  readDashboardNotificationReads,
  type DashboardNotificationReadsDoc,
} from "@/lib/dashboardNotificationReads";
import { NotificationsList } from "./notifications-ui";

type NotificationsBellProps = {
  notifications: readonly DashboardNotificationItem[];
  maxItems?: number;
  /** Clave por usuario (profile id / email) para persistir leídas. */
  userKey?: string | null;
};

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function emptyReads(): DashboardNotificationReadsDoc {
  return { version: 1, byId: {} };
}

function loadReads(userKey: string): DashboardNotificationReadsDoc {
  if (typeof window === "undefined") return emptyReads();
  return readDashboardNotificationReads(userKey);
}

export function NotificationsBell({
  notifications,
  maxItems = 5,
  userKey = null,
}: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const resolvedUserKey = String(userKey ?? "").trim() || "local";
  const [reads, setReads] = useState<DashboardNotificationReadsDoc>(() =>
    loadReads(String(userKey ?? "").trim() || "local"),
  );
  const [markError, setMarkError] = useState<string | null>(null);

  const reloadReads = useCallback(() => {
    setReads(loadReads(resolvedUserKey));
  }, [resolvedUserKey]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.includes("concasa_dashboard_notif_reads_v1_")) {
        reloadReads();
      }
    };
    const onCustom = () => reloadReads();
    window.addEventListener("storage", onStorage);
    window.addEventListener(DASHBOARD_NOTIFICATION_READS_UPDATED_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DASHBOARD_NOTIFICATION_READS_UPDATED_EVENT, onCustom);
    };
  }, [reloadReads]);

  const visible = useMemo(
    () => notifications.slice(0, maxItems),
    [notifications, maxItems],
  );
  const unreadCount = useMemo(
    () => countUnreadDashboardNotifications(notifications, reads),
    [notifications, reads],
  );

  const persistMarkRead = useCallback(
    (items: readonly DashboardNotificationItem[]) => {
      if (items.length === 0) return;
      const previous = reads;
      const optimisticById = { ...previous.byId };
      const readAt = new Date().toISOString();
      for (const item of items) {
        const id = String(item.id ?? "").trim();
        if (!id) continue;
        optimisticById[id] = {
          readAt,
          fechaSnapshot: item.fecha?.trim() || null,
        };
      }
      setReads({ version: 1, byId: optimisticById });
      setMarkError(null);
      try {
        const next = markDashboardNotificationsRead({
          userKey: resolvedUserKey,
          items,
          readAt,
        });
        setReads(next);
      } catch {
        setReads(previous);
        setMarkError("No se pudieron marcar como leídas. Reintenta abriendo la campana.");
      }
    },
    [reads, resolvedUserKey],
  );

  const close = useCallback(() => setOpen(false), []);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      if (prev) return false;
      persistMarkRead(notifications);
      return true;
    });
  }, [notifications, persistMarkRead]);

  const handleNavigate = useCallback(() => {
    persistMarkRead(notifications);
    close();
  }, [notifications, persistMarkRead, close]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative" data-testid="notifications-bell">
      <button
        type="button"
        aria-label={`Notificaciones${unreadCount > 0 ? `, ${unreadCount} nuevas` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={panelId}
        onClick={handleToggle}
        data-testid="notifications-bell-button"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        <BellIcon className="h-[18px] w-[18px]" />
        {unreadCount > 0 ? (
          <span
            data-testid="notifications-bell-badge"
            className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notificaciones"
          data-testid="notifications-bell-panel"
          className="absolute right-0 z-50 mt-2 w-[min(calc(100vw-1.5rem),20rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg sm:w-80"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-900">Notificaciones</p>
            {unreadCount > 0 ? (
              <p className="text-[10px] text-slate-500">
                {unreadCount} nueva{unreadCount === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="text-[10px] text-slate-500">Sin notificaciones nuevas</p>
            )}
            {markError ? (
              <p className="mt-1 text-[10px] text-red-600" role="alert">
                {markError}
              </p>
            ) : null}
          </div>
          <NotificationsList items={visible} compact onNavigate={handleNavigate} />
        </div>
      ) : null}
    </div>
  );
}
