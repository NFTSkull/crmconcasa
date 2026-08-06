"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminCollapsibleSection } from "@/components/admin/AdminCollapsibleSection";
import { formatDateTimeMx } from "@/lib/filters";
import { formatAdminMesaAsesorLabel } from "@/domain/admin-production/mesa-seguimiento";
import type { AdminMesaEnvioEvent } from "@/domain/admin-production";
import {
  formatBernardoDayHeading,
  type BernardoPeriodBounds,
} from "@/lib/adminBernardoPeriod";
import type {
  BernardoCitaRow,
  BernardoMetricId,
} from "@/lib/adminBernardoLoad";
import {
  groupByDayCitas,
  groupByDayIngresos,
  sortCitasByTimeAsc,
  sortIngresosDesc,
} from "@/lib/adminBernardoLoad";

type AdminBernardoDetailPanelProps = {
  metric: BernardoMetricId;
  total: number;
  bounds: BernardoPeriodBounds;
  ingresosItems: readonly AdminMesaEnvioEvent[];
  biometricosItems: readonly BernardoCitaRow[];
  firmasItems: readonly BernardoCitaRow[];
  notificacionesItems: readonly BernardoCitaRow[];
  onHide: () => void;
  onOpenExpediente: (row: AdminMesaEnvioEvent) => void;
  onOpenCita: (cita: BernardoCitaRow) => void;
};

const METRIC_TITLE: Record<BernardoMetricId, string> = {
  ingresos: "Ingresos",
  biometricos: "Biométricos",
  firmas: "Firmas",
  notificaciones: "Notificaciones a registro",
};

const EMPTY: Record<BernardoMetricId, string> = {
  ingresos: "No hubo ingresos en este periodo.",
  biometricos: "No hay citas biométricas en este periodo.",
  firmas: "No hay citas de firma en este periodo.",
  notificaciones:
    "No hay notificaciones enviadas a registro en este periodo.",
};

function VerExpedienteButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      Ver expediente
    </Button>
  );
}

function IngresosTable({
  items,
  onOpen,
}: {
  items: readonly AdminMesaEnvioEvent[];
  onOpen: (row: AdminMesaEnvioEvent) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Asesor</th>
            <th className="px-3 py-2">Fecha de ingreso</th>
            <th className="px-3 py-2">Etapa actual</th>
            <th className="px-3 py-2">Situación</th>
            <th className="px-3 py-2">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((r) => (
            <tr key={r.expedienteId}>
              <td className="px-3 py-2 font-medium text-slate-900">
                {r.clienteNombre}
              </td>
              <td className="px-3 py-2 text-slate-700">
                {formatAdminMesaAsesorLabel(r.asesorNombre)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                {formatDateTimeMx(r.fechaEnvioMesa)}
              </td>
              <td className="px-3 py-2 text-slate-700">
                {r.etapaLabel}
              </td>
              <td className="px-3 py-2">
                <AdminStatusBadge
                  situacionLabel={r.situacionLabel}
                  situacionCode={r.situacionCode}
                  cicloEstado={r.cicloEstado}
                  rechazoOperativo={r.rechazoOperativo}
                  correccionesAbiertasCount={r.correccionesAbiertasCount}
                />
              </td>
              <td className="px-3 py-2">
                <VerExpedienteButton onClick={() => onOpen(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CitasTable({
  items,
  onOpen,
  showEnvioLabel,
}: {
  items: readonly BernardoCitaRow[];
  onOpen: (cita: BernardoCitaRow) => void;
  showEnvioLabel?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Asesor</th>
            <th className="px-3 py-2">
              {showEnvioLabel ? "Fecha de envío" : "Fecha"}
            </th>
            {!showEnvioLabel ? (
              <th className="px-3 py-2">Hora</th>
            ) : null}
            <th className="px-3 py-2">
              {showEnvioLabel ? "Estado disponible" : "Estado de la cita"}
            </th>
            <th className="px-3 py-2">Etapa actual</th>
            <th className="px-3 py-2">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((r) => (
            <tr key={r.bookingId}>
              <td className="px-3 py-2 font-medium text-slate-900">
                {r.clienteNombre}
              </td>
              <td className="px-3 py-2 text-slate-700">{r.asesorNombre}</td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                {r.bookingDate}
              </td>
              {!showEnvioLabel ? (
                <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                  {r.bookingTime}
                </td>
              ) : null}
              <td className="px-3 py-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.status === "booked"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-red-50 text-red-800"
                  }`}
                >
                  {r.statusLabel}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-700">{r.etapaLabel}</td>
              <td className="px-3 py-2">
                <VerExpedienteButton onClick={() => onOpen(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayGroupsIngresos({
  items,
  singleDay,
  onOpen,
}: {
  items: readonly AdminMesaEnvioEvent[];
  singleDay: boolean;
  onOpen: (row: AdminMesaEnvioEvent) => void;
}) {
  if (items.length === 0) return null;
  if (singleDay) {
    return <IngresosTable items={sortIngresosDesc(items)} onOpen={onOpen} />;
  }
  const groups = groupByDayIngresos(items);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <AdminCollapsibleSection
          key={g.date}
          title={`${formatBernardoDayHeading(g.date)} — ${g.items.length} registro${g.items.length === 1 ? "" : "s"}`}
          defaultOpen={false}
        >
          <IngresosTable items={g.items} onOpen={onOpen} />
        </AdminCollapsibleSection>
      ))}
    </div>
  );
}

function DayGroupsCitas({
  items,
  singleDay,
  onOpen,
  showEnvioLabel,
}: {
  items: readonly BernardoCitaRow[];
  singleDay: boolean;
  onOpen: (cita: BernardoCitaRow) => void;
  showEnvioLabel?: boolean;
}) {
  if (items.length === 0) return null;
  if (singleDay) {
    return (
      <CitasTable
        items={sortCitasByTimeAsc(items)}
        onOpen={onOpen}
        showEnvioLabel={showEnvioLabel}
      />
    );
  }
  const groups = groupByDayCitas(items);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <AdminCollapsibleSection
          key={g.date}
          title={`${formatBernardoDayHeading(g.date)} — ${g.items.length} registro${g.items.length === 1 ? "" : "s"}`}
          defaultOpen={false}
        >
          <CitasTable
            items={g.items}
            onOpen={onOpen}
            showEnvioLabel={showEnvioLabel}
          />
        </AdminCollapsibleSection>
      ))}
    </div>
  );
}

export function AdminBernardoDetailPanel({
  metric,
  total,
  bounds,
  ingresosItems,
  biometricosItems,
  firmasItems,
  notificacionesItems,
  onHide,
  onOpenExpediente,
  onOpenCita,
}: AdminBernardoDetailPanelProps) {
  const singleDay = bounds.fromDate === bounds.toDateInclusive;
  const period = `${bounds.fromDate} — ${bounds.toDateInclusive}`;
  const emptyMsg = EMPTY[metric];

  let body: ReactNode = null;
  if (metric === "ingresos") {
    body =
      ingresosItems.length === 0 ? (
        <AdminEmptyState title={emptyMsg} />
      ) : (
        <DayGroupsIngresos
          items={ingresosItems}
          singleDay={singleDay}
          onOpen={onOpenExpediente}
        />
      );
  } else if (metric === "biometricos") {
    body =
      biometricosItems.length === 0 ? (
        <AdminEmptyState title={emptyMsg} />
      ) : (
        <DayGroupsCitas
          items={biometricosItems}
          singleDay={singleDay}
          onOpen={onOpenCita}
        />
      );
  } else if (metric === "firmas") {
    body =
      firmasItems.length === 0 ? (
        <AdminEmptyState title={emptyMsg} />
      ) : (
        <DayGroupsCitas
          items={firmasItems}
          singleDay={singleDay}
          onOpen={onOpenCita}
        />
      );
  } else {
    body =
      notificacionesItems.length === 0 ? (
        <AdminEmptyState title={emptyMsg} />
      ) : (
        <DayGroupsCitas
          items={notificacionesItems}
          singleDay={singleDay}
          onOpen={onOpenCita}
          showEnvioLabel
        />
      );
  }

  return (
    <section
      id={`bernardo-metric-${metric}-detail`}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-labelledby={`bernardo-metric-${metric}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {METRIC_TITLE[metric]}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Total: <span className="font-medium tabular-nums">{total}</span>
            {" · "}
            Periodo: {period}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={onHide}>
          Ocultar detalle
        </Button>
      </div>
      <div className="mt-4">{body}</div>
    </section>
  );
}
