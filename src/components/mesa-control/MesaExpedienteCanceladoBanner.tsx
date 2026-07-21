"use client";

import type { ExpedienteCancelacionRow } from "@/domain/expedientes";

type Props = {
  cancelacion: ExpedienteCancelacionRow | null;
  formatDateTime: (iso: string | null | undefined) => string;
};

export function MesaExpedienteCanceladoBanner({
  cancelacion,
  formatDateTime,
}: Props) {
  return (
    <section
      data-testid="mesa-expediente-cancelado-banner"
      className="rounded-xl border border-slate-400 bg-slate-100 px-4 py-3"
      role="status"
    >
      <p className="text-sm font-semibold text-slate-900">
        Expediente cancelado (terminal)
      </p>
      <p className="mt-1 text-xs text-slate-700">
        El ciclo está cerrado operativamente. No hay avance, rechazo, reingreso
        ni agendado en el flujo normal.
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
          <div>
            <dt className="font-medium text-slate-600">Etapa al cancelar</dt>
            <dd>{cancelacion.etapa}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-600">Subestado previo</dt>
            <dd>{cancelacion.subestadoAnterior}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          Historial de cancelación no disponible en esta vista.
        </p>
      )}
    </section>
  );
}
