"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import {
  formatAdminMesaAsesorLabel,
  formatAdminMesaEsperaLabel,
  labelAdminMesaAction,
  sanitizeAdminMotivo,
  type AdminMesaTimelineEvent,
} from "@/domain/admin-production/mesa-seguimiento";
import {
  decisionBadgeClass,
  formatPrecalMontoAlAprobarDisplay,
  labelEditorDecision,
  type AdminMesaEnvioEvent,
  type AdminPrecalEvent,
} from "@/domain/admin-production";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import { formatDateTimeMx } from "@/lib/filters";
import { formatMontoMX } from "@/lib/monto";

export type AdminExpedienteDrawerTab =
  | "resumen"
  | "seguimiento"
  | "precalificacion";

type AdminExpedienteDrawerProps = {
  open: boolean;
  row: AdminMesaEnvioEvent | null;
  onClose: () => void;
  /** Precal ya cargada en Admin (si existe para este expediente). Sin consultas nuevas. */
  precal?: AdminPrecalEvent | null;
  timelineItems: readonly AdminMesaTimelineEvent[];
  timelineLoading: boolean;
  timelineError: string | null;
  timelineHasMore: boolean;
  timelineLoadingMore: boolean;
  timelineOffset: number;
  timelineTotal: number;
  onLoadMoreTimeline: () => void;
  correccionText: string;
  rechazoText: string;
};

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

/**
 * Drawer lateral de expediente Admin (B2).
 * Solo muestra datos ya disponibles; reutiliza el timeline cargado por page.
 * El panel interno se remonta con key=expedienteId para resetear la tab a Resumen.
 */
export function AdminExpedienteDrawer({
  open,
  row,
  onClose,
  precal = null,
  timelineItems,
  timelineLoading,
  timelineError,
  timelineHasMore,
  timelineLoadingMore,
  timelineOffset,
  timelineTotal,
  onLoadMoreTimeline,
  correccionText,
  rechazoText,
}: AdminExpedienteDrawerProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open, row?.expedienteId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  return (
    <AdminExpedienteDrawerPanel
      key={row.expedienteId}
      titleId={titleId}
      dialogRef={dialogRef}
      row={row}
      onClose={onClose}
      precal={precal}
      timelineItems={timelineItems}
      timelineLoading={timelineLoading}
      timelineError={timelineError}
      timelineHasMore={timelineHasMore}
      timelineLoadingMore={timelineLoadingMore}
      timelineOffset={timelineOffset}
      timelineTotal={timelineTotal}
      onLoadMoreTimeline={onLoadMoreTimeline}
      correccionText={correccionText}
      rechazoText={rechazoText}
    />
  );
}

type PanelProps = {
  titleId: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  row: AdminMesaEnvioEvent;
  onClose: () => void;
  precal?: AdminPrecalEvent | null;
  timelineItems: readonly AdminMesaTimelineEvent[];
  timelineLoading: boolean;
  timelineError: string | null;
  timelineHasMore: boolean;
  timelineLoadingMore: boolean;
  timelineOffset: number;
  timelineTotal: number;
  onLoadMoreTimeline: () => void;
  correccionText: string;
  rechazoText: string;
};

function AdminExpedienteDrawerPanel({
  titleId,
  dialogRef,
  row,
  onClose,
  precal = null,
  timelineItems,
  timelineLoading,
  timelineError,
  timelineHasMore,
  timelineLoadingMore,
  timelineOffset,
  timelineTotal,
  onLoadMoreTimeline,
  correccionText,
  rechazoText,
}: PanelProps) {
  const [tab, setTab] = useState<AdminExpedienteDrawerTab>("resumen");
  const etapa =
    row.etapaActual === 10 || /cita para firma/i.test(String(row.etapaLabel ?? ""))
      ? getAdminEtapaDisplayNombre(row.etapaActual)
      : row.etapaLabel || getAdminEtapaDisplayNombre(row.etapaActual);
  const tabs: { id: AdminExpedienteDrawerTab; label: string }[] = [
    { id: "resumen", label: "Resumen" },
    { id: "seguimiento", label: "Seguimiento" },
    { id: "precalificacion", label: "Precalificación" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full max-w-full flex-col border-l border-slate-200 bg-white shadow-xl outline-none sm:max-w-[min(100%,32rem)] md:w-[50%] md:max-w-[36rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-base font-semibold text-slate-900"
            >
              {row.clienteNombre}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">{etapa}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AdminStatusBadge
                situacionLabel={row.situacionLabel}
                situacionCode={row.situacionCode}
                cicloEstado={row.cicloEstado}
                rechazoOperativo={row.rechazoOperativo}
                correccionesAbiertasCount={row.correccionesAbiertasCount}
              />
              <span className="text-xs text-slate-600">
                {formatAdminMesaAsesorLabel(row.asesorNombre)}
              </span>
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <Link
            href={`/admin/${row.expedienteId}`}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Abrir expediente completo
          </Link>
        </div>

        <div
          role="tablist"
          aria-label="Detalle del expediente"
          className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2"
        >
          {tabs.map((t) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${
                  selected
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tab === "resumen" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Etapa actual" value={etapa} />
              <Field
                label="Situación"
                value={
                  <AdminStatusBadge
                    situacionLabel={row.situacionLabel}
                    situacionCode={row.situacionCode}
                    cicloEstado={row.cicloEstado}
                    rechazoOperativo={row.rechazoOperativo}
                    correccionesAbiertasCount={row.correccionesAbiertasCount}
                  />
                }
              />
              <Field
                label="Asesor"
                value={formatAdminMesaAsesorLabel(row.asesorNombre)}
              />
              <Field
                label="Fecha de envío"
                value={
                  row.fechaEnvioMesa
                    ? formatDateTimeMx(row.fechaEnvioMesa)
                    : "Sin envío"
                }
              />
              <Field
                label="Última actividad"
                value={
                  row.ultimaActividadMesaAt ? (
                    <>
                      {formatDateTimeMx(row.ultimaActividadMesaAt)}
                      <p className="mt-0.5 text-xs font-normal text-slate-600">
                        {row.ultimaActividadMesaLabel ||
                          labelAdminMesaAction(row.ultimaActividadMesaCode)}
                      </p>
                    </>
                  ) : (
                    "Sin actividad de Mesa registrada"
                  )
                }
              />
              <Field
                label="Espera actual"
                value={
                  <>
                    {formatAdminMesaEsperaLabel({
                      esperaLabel: row.esperaLabel,
                      esperaDesde: row.esperaDesde,
                    })}
                    {row.esperaDesde ? (
                      <p className="mt-0.5 text-xs font-normal text-slate-600">
                        {formatDateTimeMx(row.esperaDesde)}
                      </p>
                    ) : null}
                  </>
                }
              />
              <Field
                label="Siguiente acción"
                value={
                  <>
                    {row.siguienteAccionLabel}
                    <p className="mt-0.5 text-xs font-normal text-slate-600">
                      Actor: {row.siguienteAccionActor}
                    </p>
                  </>
                }
              />
              <Field label="Corrección" value={correccionText} />
              {row.rechazoOperativo ? (
                <Field label="Rechazo operativo" value={rechazoText} />
              ) : null}
              {row.reingresoActivo ? (
                <Field label="Reingreso" value="Activo" />
              ) : null}
              <Field label="Programa" value={row.programa || "—"} />
            </div>
          ) : null}

          {tab === "seguimiento" ? (
            <div>
              <p className="text-xs text-slate-500">
                Más reciente primero · solo lectura
              </p>
              {timelineLoading ? (
                <p className="mt-4 text-sm text-slate-700">Cargando seguimiento…</p>
              ) : timelineError ? (
                <p className="mt-4 text-sm text-red-700">{timelineError}</p>
              ) : timelineItems.length === 0 ? (
                <p className="mt-4 text-sm text-slate-700">
                  No hay actividad registrada.
                </p>
              ) : (
                <>
                  <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-slate-800">
                    {timelineItems.map((ev, idx) => {
                      const doc = ev.summary.tipo_documento?.trim();
                      const motivo = sanitizeAdminMotivo(ev.summary.motivo);
                      const showMotivo = Boolean(ev.summary.motivo?.trim());
                      return (
                        <li key={`${ev.at}-${ev.action}-${idx}`}>
                          <span className="whitespace-nowrap font-medium text-slate-900">
                            {formatDateTimeMx(ev.at)}
                          </span>
                          {" · "}
                          <span>{labelAdminMesaAction(ev.action)}</span>
                          {ev.actorGeneral ? (
                            <span className="text-xs text-slate-600">
                              {" "}
                              ({ev.actorGeneral})
                            </span>
                          ) : null}
                          {doc ? (
                            <p className="mt-0.5 text-xs text-slate-700">
                              Documento: {doc}
                            </p>
                          ) : null}
                          {showMotivo ? (
                            <p className="mt-0.5 text-xs text-slate-700">
                              Motivo: {motivo}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {timelineHasMore ? (
                    <div className="mt-4">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={timelineLoadingMore}
                        onClick={onLoadMoreTimeline}
                      >
                        {timelineLoadingMore
                          ? "Cargando…"
                          : `Cargar más (${timelineOffset}/${timelineTotal})`}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {tab === "precalificacion" ? (
            <div className="space-y-3">
              {precal ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field
                    label="Resultado"
                    value={
                      <span className={decisionBadgeClass(precal.decision)}>
                        {labelEditorDecision(precal.decision)}
                      </span>
                    }
                  />
                  <Field
                    label="Fecha"
                    value={
                      precal.decision === "pendiente"
                        ? "—"
                        : precal.fecha
                          ? formatDateTimeMx(precal.fecha)
                          : "—"
                    }
                  />
                  <Field
                    label="Monto al aprobar"
                    value={formatPrecalMontoAlAprobarDisplay(
                      {
                        montoAprobadoAlAprobar: precal.montoAprobadoAlAprobar,
                        montoSnapshotNoRecuperable:
                          precal.montoSnapshotNoRecuperable,
                      },
                      formatMontoMX,
                    )}
                  />
                  <Field label="Programa" value={precal.programa || "—"} />
                </div>
              ) : (
                <p className="text-sm text-slate-700">
                  El resumen de precalificación no está cargado en esta vista
                  (filtros de periodo/decisión distintos). Ábrelo en pantalla
                  completa para ver el detalle.
                </p>
              )}
              <Link
                href={`/admin/${row.expedienteId}`}
                className="inline-flex text-sm font-medium text-blue-700 underline"
              >
                Abrir pantalla completa
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
