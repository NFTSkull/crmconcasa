"use client";

import type { AdminMesaEnvioEvent } from "@/domain/admin-production/metrics";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import { labelAdminMesaAction } from "@/domain/admin-production/mesa-seguimiento";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { formatDateTimeMx } from "@/lib/filters";

type Props = {
  title: string;
  subtitle: string;
  items: readonly AdminMesaEnvioEvent[];
  totalCount: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  countMismatch: boolean;
  stageCount: number | null;
  onPageChange: (page: number) => void;
  onOpenDetalle: (row: AdminMesaEnvioEvent, trigger: HTMLButtonElement) => void;
};

function etapaLabelAdmin(r: AdminMesaEnvioEvent): string {
  if (
    r.etapaActual === 10 ||
    /cita para firma/i.test(String(r.etapaLabel ?? ""))
  ) {
    return getAdminEtapaDisplayNombre(r.etapaActual);
  }
  return r.etapaLabel || getAdminEtapaDisplayNombre(r.etapaActual);
}

/**
 * Lista on-demand de expedientes al Expandir una fila de Producción.
 */
export function AdminProductionExpandedExpedientes(props: Props) {
  const totalPages = Math.max(1, Math.ceil(props.totalCount / props.pageSize));
  const showPager = props.totalCount > props.pageSize;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {props.title}
        </p>
        <p className="mt-1 text-sm text-slate-800">{props.subtitle}</p>
        {props.countMismatch && props.stageCount != null ? (
          <p className="mt-1 text-xs text-amber-800" role="status">
            Aviso: el conteo por etapas ({props.stageCount}) no coincide con la
            lista ({props.totalCount}). Se muestran los expedientes de la
            consulta; no se oculta la diferencia.
          </p>
        ) : null}
      </div>

      {props.loading ? (
        <p className="text-sm text-slate-600">Cargando expedientes…</p>
      ) : null}
      {props.error ? (
        <p className="text-sm text-red-700" role="alert">
          {props.error}
        </p>
      ) : null}

      {!props.loading && !props.error && props.totalCount === 0 ? (
        <p className="text-sm text-slate-600">No hay expedientes para este filtro.</p>
      ) : null}

      {!props.loading && props.items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">Cliente</th>
                <th className="px-2 py-1.5 font-medium">Etapa</th>
                <th className="px-2 py-1.5 font-medium">Situación</th>
                <th className="px-2 py-1.5 font-medium">Última actividad</th>
                <th className="px-2 py-1.5 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((r) => (
                <tr key={r.expedienteId} className="border-b border-slate-50 align-top">
                  <td className="px-2 py-1.5 font-medium text-slate-900">
                    {r.clienteNombre}
                  </td>
                  <td className="px-2 py-1.5">{etapaLabelAdmin(r)}</td>
                  <td className="px-2 py-1.5">
                    <AdminStatusBadge
                      situacionLabel={r.situacionLabel}
                      situacionCode={r.situacionCode}
                      cicloEstado={r.cicloEstado}
                      rechazoOperativo={r.rechazoOperativo}
                      correccionesAbiertasCount={r.correccionesAbiertasCount}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {r.ultimaActividadMesaAt ? (
                      <>
                        <span className="whitespace-nowrap">
                          {formatDateTimeMx(r.ultimaActividadMesaAt)}
                        </span>
                        <p className="mt-0.5 text-xs text-gray-700">
                          {r.ultimaActividadMesaLabel ||
                            labelAdminMesaAction(r.ultimaActividadMesaCode)}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">
                        Sin actividad registrada
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      className="text-blue-700 underline"
                      onClick={(e) => props.onOpenDetalle(r, e.currentTarget)}
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showPager ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">
            Página {props.page} de {totalPages} · {props.totalCount} en total
          </span>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-800 disabled:opacity-40"
            disabled={props.page <= 1 || props.loading}
            onClick={() => props.onPageChange(props.page - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-800 disabled:opacity-40"
            disabled={props.page >= totalPages || props.loading}
            onClick={() => props.onPageChange(props.page + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
