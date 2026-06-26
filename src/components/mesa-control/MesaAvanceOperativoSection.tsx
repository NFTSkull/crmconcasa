"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MESA_AVISO_SIN_RECHAZO_DIRECTO,
  MESA_DECISION_TITULO_AVANCE,
  type MesaAvanceOperativoCopy,
} from "@/domain/expedientes/mesa-decision-ux";
import type { AvanceOperativoEtapaView } from "@/domain/expedientes/mesa-avance-integracion";

export type { MesaAvanceOperativoCopy } from "@/domain/expedientes/mesa-decision-ux";

export {
  MESA_AVANCE_OPERATIVO_2A3_COPY,
  MESA_AVANCE_OPERATIVO_3A4_COPY,
  MESA_AVANCE_OPERATIVO_4A5_COPY,
  MESA_AVANCE_OPERATIVO_5A6_COPY,
  MESA_AVANCE_OPERATIVO_6A7_COPY,
  MESA_AVANCE_OPERATIVO_7A8_COPY,
  MESA_AVANCE_OPERATIVO_8A9_COPY,
  MESA_AVANCE_OPERATIVO_9A10_COPY,
} from "@/domain/expedientes/mesa-decision-ux";

type Props = {
  view: AvanceOperativoEtapaView;
  copy: MesaAvanceOperativoCopy;
  puedeOperar: boolean;
  loading: boolean;
  error: string | null;
  success: string | null;
  onAvanzar: () => Promise<void>;
};

export function MesaAvanceOperativoSection({
  view,
  copy,
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

  const titulo = copy.titulo ?? MESA_DECISION_TITULO_AVANCE;

  return (
    <>
      <section
        className="overflow-hidden rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/40 to-white shadow-sm"
        aria-label="Avance operativo Mesa"
      >
        <header className="border-b border-sky-100 bg-white px-4 py-4">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">{copy.descripcion}</p>
        </header>

        <div className="space-y-3 p-4">
          {copy.mostrarAvisoSinRechazo ? (
            <p
              role="note"
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700"
            >
              {MESA_AVISO_SIN_RECHAZO_DIRECTO}
            </p>
          ) : null}

          {view.bloqueos.length > 0 ? (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
            >
              <p className="font-medium">Requisitos pendientes</p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs">
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
            <div className="border-t border-sky-100 pt-3">
              <Button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!view.puedeAvanzar || loading}
              >
                {loading ? "Avanzando…" : copy.etiquetaBoton}
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
            aria-labelledby="mesa-avance-operativo-title"
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mesa-avance-operativo-title" className="text-base font-semibold text-gray-900">
              Confirmar aceptación y avance
            </h3>
            <p className="mt-2 text-sm text-gray-600">{copy.mensajeConfirmacion}</p>
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
