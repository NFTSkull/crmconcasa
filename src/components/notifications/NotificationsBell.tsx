"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";
import { NotificationsList } from "./notifications-ui";

type NotificationsBellProps = {
  notifications: readonly DashboardNotificationItem[];
  maxItems?: number;
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

export function NotificationsBell({
  notifications,
  maxItems = 5,
}: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const visible = useMemo(
    () => notifications.slice(0, maxItems),
    [notifications, maxItems],
  );
  const count = notifications.length;

  const close = useCallback(() => setOpen(false), []);

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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Notificaciones${count > 0 ? `, ${count} pendientes` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        <BellIcon className="h-[18px] w-[18px]" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notificaciones"
          className="absolute right-0 z-50 mt-2 w-[min(calc(100vw-1.5rem),20rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg sm:w-80"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-900">Notificaciones</p>
            {count > 0 ? (
              <p className="text-[10px] text-slate-500">
                {count} pendiente{count === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          <NotificationsList items={visible} compact onNavigate={close} />
        </div>
      ) : null}
    </div>
  );
}
