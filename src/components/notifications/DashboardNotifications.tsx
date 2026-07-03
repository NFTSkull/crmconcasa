"use client";

import { NotificationsList } from "./notifications-ui";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";

type DashboardNotificationsProps = {
  items: readonly DashboardNotificationItem[];
  expedienteLinkLabel?: string;
};

/** Panel inline (legacy); preferir `NotificationsBell` en el header. */
export function DashboardNotifications({
  items,
  expedienteLinkLabel = "Ver expediente",
}: DashboardNotificationsProps) {
  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
      aria-label="Notificaciones del dashboard"
    >
      <h3 className="text-sm font-semibold text-slate-900">Notificaciones</h3>
      <div className="mt-2">
        <NotificationsList items={items} expedienteLinkLabel={expedienteLinkLabel} />
      </div>
    </section>
  );
}
