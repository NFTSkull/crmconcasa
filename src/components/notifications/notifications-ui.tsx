import Link from "next/link";
import { formatDateTimeMx } from "@/lib/filters";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";

export function kindBadgeClass(kind: DashboardNotificationItem["kind"]): string {
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

export function formatNotificationFecha(fecha: string | null): string {
  if (!fecha?.trim()) return "—";
  const parsed = Date.parse(fecha);
  if (Number.isNaN(parsed)) return fecha;
  return formatDateTimeMx(fecha);
}

type NotificationsListProps = {
  items: readonly DashboardNotificationItem[];
  expedienteLinkLabel?: string;
  onNavigate?: () => void;
  compact?: boolean;
};

export function NotificationsList({
  items,
  expedienteLinkLabel = "Ver expediente",
  onNavigate,
  compact = false,
}: NotificationsListProps) {
  if (items.length === 0) {
    return <p className="px-3 py-4 text-xs text-slate-500">Sin notificaciones pendientes.</p>;
  }

  return (
    <ul className={compact ? "max-h-[min(70vh,24rem)] overflow-y-auto" : "space-y-2"}>
      {items.map((item) => (
        <li
          key={item.id}
          className={
            compact
              ? "border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              : "flex flex-col gap-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
          }
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
            onClick={onNavigate}
            className="mt-1.5 inline-block shrink-0 text-xs font-medium text-blue-700 hover:underline sm:mt-0"
          >
            {expedienteLinkLabel}
          </Link>
        </li>
      ))}
    </ul>
  );
}
