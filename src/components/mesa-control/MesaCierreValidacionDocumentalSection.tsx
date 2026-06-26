"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MESA_CIERRE_INTEGRACION_COPY } from "@/domain/expedientes/mesa-decision-ux";
import type { CierreValidacionDocumentalView } from "@/domain/expedientes/mesa-avance-integracion";

function checklistIcon(completo: boolean): string {
  return completo ? "✓" : "○";
}

function checklistRowClass(completo: boolean): string {
  return completo
    ? "border-emerald-100 bg-emerald-50/60 text-emerald-950"
    : "border-amber-100 bg-amber-50/50 text-amber-950";
}

type Props = {
  view: CierreValidacionDocumentalView;
  puedeOperar: boolean;
  loading: boolean;
  error: string | null;
  success: string | null;
  onAvanzar: () => Promise<void>;
};

export function MesaCierreValidacionDocumentalSection({
  view,
  puedeOperar,
  loading,
  error,
  success,
  onAvanzar,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmar = useCallback(() => {
    void onAvanzar().finally(() => setConfirmOpen(false));
  }, [onAvanzar]);

  if (!view.mostrar) return null;

  return (
    <>
      <section
        className="overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/40 to-white shadow-sm"
        aria-label="Cierre de validación documental"
      >
        <header className="border-b border-emerald-100 bg-white px-4 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {MESA_CIERRE_INTEGRACION_COPY.titulo}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            {MESA_CIERRE_INTEGRACION_COPY.descripcion} Los documentos complementarios no bloquean
            este avance.
          </p>
        </header>

        <div className="space-y-3 p-4">
          <div
            className={`rounded-lg border px-3 py-2.5 text-sm ${checklistRowClass(view.datosGeneralesValidados)}`}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 font-semibold" aria-hidden>
                {checklistIcon(view.datosGeneralesValidados)}
              </span>
              <div>
                <p className="font-medium">Datos generales validados</p>
                <p className="mt-0.5 text-xs opacity-90">{view.datosGeneralesDetalle}</p>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              5 documentos del asesor (obligatorios)
            </p>
            <ul className="space-y-1.5">
              {view.documentosAsesor.map((doc) => (
                <li
                  key={doc.tipo}
                  className={`rounded-lg border px-3 py-2 text-sm ${checklistRowClass(doc.completo)}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 font-semibold" aria-hidden>
                      {checklistIcon(doc.completo)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{doc.label}</p>
                      <p className="mt-0.5 text-xs capitalize opacity-90">{doc.detalle}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Complementarios opcionales (no bloquean)
            </p>
            <ul className="space-y-1.5">
              {view.complementarios.map((doc) => (
                <li
                  key={doc.tipo}
                  className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm text-violet-950"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-violet-600" aria-hidden>
                      ·
                    </span>
                    <div>
                      <p className="font-medium">{doc.label}</p>
                      <p className="mt-0.5 text-xs opacity-90">{doc.detalle}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {view.bloqueos.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-900">Pendiente para avanzar:</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-sm text-amber-950">
                {view.bloqueos.map((bloqueo) => (
                  <li key={bloqueo}>{bloqueo}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}

          {success ? (
            <p
              role="status"
              className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-900"
            >
              {success}
            </p>
          ) : null}

          {puedeOperar ? (
            <div className="border-t border-emerald-100 pt-3">
              <Button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!view.puedeAvanzar || loading}
              >
                {loading ? "Avanzando…" : MESA_CIERRE_INTEGRACION_COPY.etiquetaBoton}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => !loading && setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mesa-cierre-avance-title"
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mesa-cierre-avance-title" className="text-base font-semibold text-gray-900">
              Confirmar aceptación y avance
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {MESA_CIERRE_INTEGRACION_COPY.mensajeConfirmacion}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => setConfirmOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="button" disabled={loading} onClick={() => void handleConfirmar()}>
                {loading ? "Avanzando…" : "Confirmar aceptación"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
