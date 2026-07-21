"use client";

import {
  ETAPAS_VISUALES_OPERATIVAS,
  MSJ_SEGUIMIENTO_PRE_ENVIO,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
  asesorSubestadoOperativoLabel,
  estadoEnvioMesaLabel,
  etapaTimelineBadgeClass,
  etapaTimelineCardClass,
  etapaTimelineCircleClass,
  getEtapaTimelineBadgeLabel,
  getEtapaTimelineVisualPorPasoVisual,
  resolveEtapaActualOperativa,
} from "@/domain/expedientes/asesor-seguimiento-operativo";
import {
  formatEtapaAsesorCorrespondenciaMesa,
  formatEtapaAsesorPasoLabel,
  NOTA_NUMERACION_ETAPAS,
} from "@/domain/expedientes/etapa-numeracion-ux";

export interface AsesorSeguimientoOperativoProps {
  etapaActual: number | null;
  subestado?: string | null;
  submittedToMesa: boolean;
  fechaEnvioMesa?: string | null;
  updatedAt?: string | null;
  cicloEstado?: string | null;
  origenMesa?: string | null;
  formatDateTime: (iso: string) => string;
}

function cicloEstadoLabel(cicloEstado: string | null | undefined): string | null {
  const v = String(cicloEstado ?? "").trim();
  if (v === "cerrado") return "Ciclo cerrado";
  if (v === "activo") return null;
  return v ? v : null;
}

export function AsesorSeguimientoOperativo({
  etapaActual,
  subestado,
  submittedToMesa,
  fechaEnvioMesa,
  updatedAt,
  cicloEstado,
  origenMesa,
  formatDateTime,
}: AsesorSeguimientoOperativoProps) {
  const etapaResuelta = resolveEtapaActualOperativa(etapaActual);
  const subestadoLabel = asesorSubestadoOperativoLabel(subestado, submittedToMesa);
  const envioLabel = estadoEnvioMesaLabel(submittedToMesa);
  const cicloLabel = cicloEstadoLabel(cicloEstado);

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600"
      aria-label="Seguimiento operativo"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Seguimiento operativo</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Vista de solo lectura del avance del expediente en Mesa de Control.
          </p>
        </div>
        {origenMesa ? (
          <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-700">
            Origen Mesa: {origenMesa}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Etapa actual
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {formatEtapaAsesorPasoLabel(etapaResuelta)}
          </p>
          <p
            className="mt-1 text-xs text-gray-500"
            data-testid="asesor-etapa-correspondencia-mesa"
          >
            {formatEtapaAsesorCorrespondenciaMesa(etapaResuelta)}
          </p>
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Subestado / estatus
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">{subestadoLabel}</p>
          {cicloLabel ? (
            <p className="mt-1 text-xs text-gray-500">{cicloLabel}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Estado de envío
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">{envioLabel}</p>
          {submittedToMesa && fechaEnvioMesa ? (
            <p className="mt-1 text-xs text-gray-500">
              Enviado: {formatDateTime(fechaEnvioMesa)}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Última actualización
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {updatedAt ? formatDateTime(updatedAt) : "—"}
          </p>
        </div>
      </div>

      {!submittedToMesa ? (
        <p role="status" className="mt-3 text-xs text-amber-800">
          {MSJ_SEGUIMIENTO_PRE_ENVIO}
        </p>
      ) : null}

      <div className="mt-4">
        <p className="text-sm font-medium text-gray-800">
          Timeline / Etapas ({TOTAL_PASOS_VISUALES_OPERATIVOS} pasos)
        </p>
        <p className="mt-0.5 text-xs text-gray-500">{NOTA_NUMERACION_ETAPAS}</p>
        <ol className="mt-2 max-h-[320px] space-y-1 overflow-y-auto pr-1 text-sm">
          {ETAPAS_VISUALES_OPERATIVAS.map((etapa) => {
            const visual = getEtapaTimelineVisualPorPasoVisual(
              etapa.pasoVisual,
              etapaResuelta,
            );
            const badgeLabel = getEtapaTimelineBadgeLabel(
              visual,
              etapa.etapaInterna,
              subestado,
              submittedToMesa,
            );

            return (
              <li
                key={etapa.etapaInterna}
                className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${etapaTimelineCardClass(visual)}`}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${etapaTimelineCircleClass(visual)}`}
                    aria-hidden
                  >
                    {etapa.pasoVisual}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{etapa.nombre}</p>
                    {etapa.pasoVisual !== etapa.etapaInterna ? (
                      <p className="text-[11px] text-gray-500">
                        Etapa interna {etapa.etapaInterna}
                      </p>
                    ) : null}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${etapaTimelineBadgeClass(visual, badgeLabel)}`}
                >
                  {badgeLabel}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
