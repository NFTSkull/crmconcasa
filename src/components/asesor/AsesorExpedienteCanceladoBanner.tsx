"use client";

import type { ExpedienteCancelacionRow } from "@/domain/expedientes";

type Props = {
  cancelacion: ExpedienteCancelacionRow | null;
  formatDateTime: (iso: string | null | undefined) => string;
};

/** Banner RO de expediente cancelado en detalle Asesor (P094 B3). */
export function AsesorExpedienteCanceladoBanner({
  cancelacion,
  formatDateTime,
}: Props) {
  return (
    <section
      data-testid="asesor-expediente-cancelado-banner"
      className="rounded-xl border border-slate-400 bg-slate-100 px-4 py-3"
      role="status"
    >
      <p className="text-sm font-semibold text-slate-900">
        Expediente cancelado (terminal)
      </p>
      <p className="mt-1 text-xs text-slate-700">
        Este expediente quedó fuera del flujo operativo. No puedes enviar a Mesa,
        corregir documentos, agendar citas ni iniciar reingreso.
      </p>
      {cancelacion ? (
        <dl className="mt-3 grid gap-1 text-xs text-slate-800 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-slate-600">Motivo</dt>
            <dd>{cancelacion.motivo}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-600">Fecha</dt>
            <dd>{formatDateTime(cancelacion.createdAt)}</dd>
          </div>
          {cancelacion.comentario ? (
            <div className="sm:col-span-2">
              <dt className="font-medium text-slate-600">Comentario</dt>
              <dd>{cancelacion.comentario}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          Historial de cancelación no disponible en esta vista.
        </p>
      )}
    </section>
  );
}
