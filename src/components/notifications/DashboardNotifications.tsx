"use client";

import Link from "next/link";
import { formatDateTimeMx } from "@/lib/filters";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";

function kindBadgeClass(kind: DashboardNotificationItem["kind"]): string {
  if (kind === "correccion_requerida" || kind === "rechazado_mesa") {
    return "bg-amber-100 text-amber-950 ring-amber-200";
  }
  if (kind === "correccion_enviada" || kind === "enviado_mesa") {
    return "bg-sky-100 text-sky-900 ring-sky-200";
  }
  if (kind === "cita_hoy" || kind === "cita_programada" || kind === "cita_cambio") {
    return "bg-violet-100 text-violet-900 ring-violet-200";
  }
  return "bg-slate-100 text-slate-800 ring-slate-200";
}

function formatNotificationFecha(fecha: string | null): string {
  if (!fecha?.trim()) return "—";
  const parsed = Date.parse(fecha);
  if (Number.isNaN(parsed)) return fecha;
  return formatDateTimeMx(fecha);
}

type DashboardNotificationsProps = {
  items: readonly DashboardNotificationItem[];
  expedienteLinkLabel?: string;
};

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
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Sin notificaciones pendientes.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${kindBadgeClass(item.kind)}`}
                  >
                    {item.tipoLabel}
                  </span>
                  <span className="truncate text-xs font-medium text-slate-900">
                    {item.clienteNombre}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{item.mensaje}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {formatNotificationFecha(item.fecha)}
                </p>
              </div>
              <Link
                href={item.href}
                className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
              >
                {expedienteLinkLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
