"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MESA_AVISO_SIN_RECHAZO_DIRECTO,
  MESA_DECISION_TITULO_AVANCE,
  type MesaAvanceOperativoCopy,
} from "@/domain/expedientes/mesa-decision-ux";
import type { AvanceOperativoEtapaView } from "@/domain/expedientes/mesa-avance-integracion";
import {
  explainMesaShowCancelCitaOperativa,
  MESA_CANCEL_BIO_BUTTON_LABEL,
  MESA_CANCEL_FIRMAS_BUTTON_LABEL,
  MESA_CANCEL_NOTIFICACION_BUTTON_LABEL,
  type MesaAgendaCancelKind,
} from "@/lib/mesaAgendaCancelAccess";

export type MesaAvanceCancelCitaGate = Readonly<{
  kind: MesaAgendaCancelKind;
  mockRole: string | null;
  sessionRole: string | null;
  submittedToMesa: boolean;
  subestado: string | null;
  cicloEstado: string | null;
  etapaActual: number | null;
  hasActiveBooking: boolean;
  fechaCita: string | null;
  success: string | null;
  cancelledMotivo: string | null;
  onRequest: () => void;
}>;

export type { MesaAvanceOperativoCopy } from "@/domain/expedientes/mesa-decision-ux";

export {
  MESA_AVANCE_OPERATIVO_2A3_COPY,
  MESA_AVANCE_OPERATIVO_3A4_COPY,
  MESA_AVANCE_OPERATIVO_3A5_COPY,
  MESA_AVANCE_OPERATIVO_4A5_COPY,
  MESA_AVANCE_OPERATIVO_5A6_COPY,
  MESA_AVANCE_OPERATIVO_6A7_COPY,
  MESA_AVANCE_OPERATIVO_7A8_COPY,
  MESA_AVANCE_OPERATIVO_8A9_COPY,
  MESA_AVANCE_OPERATIVO_9A10_COPY,
  MESA_FIRMA_ETAPA10_OPERATIVA_COPY,
} from "@/domain/expedientes/mesa-decision-ux";

type Props = {
  view: AvanceOperativoEtapaView;
  copy: MesaAvanceOperativoCopy;
  puedeOperar: boolean;
  loading: boolean;
  error: string | null;
  success: string | null;
  onAvanzar: () => Promise<void>;
  /** Gate evaluado dentro del panel Decisión Mesa (misma pantalla que avance). */
  cancelCitaGate?: MesaAvanceCancelCitaGate | null;
  /** Si false, oculta botón avanzar aunque `view.puedeAvanzar` (p. ej. etapa 10 solo cancel). */
  mostrarBotonAvanzar?: boolean;
  /** Si true, muestra atajo al panel «Movimiento manual de Mesa» cuando el avance está bloqueado. */
  mostrarAtajoMovimientoManual?: boolean;
};

export const MESA_ATAJO_MOVIMIENTO_MANUAL_TEXTO =
  "También puedes usar el movimiento manual de Mesa para continuar sin cita.";

export const MESA_MOVIMIENTO_MANUAL_ANCHOR_ID = "mesa-movimiento-manual";

const DEBUG_MESA_CANCEL =
  process.env.NEXT_PUBLIC_DEBUG_MESA_CANCEL === "1" ||
  process.env.NEXT_PUBLIC_DEBUG_MESA_CANCEL === "true";

export function MesaAvanceOperativoSection({
  view,
  copy,
  puedeOperar,
  loading,
  error,
  success,
  onAvanzar,
  cancelCitaGate = null,
  mostrarBotonAvanzar = true,
  mostrarAtajoMovimientoManual = false,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmar = useCallback(() => {
    void onAvanzar().finally(() => setConfirmOpen(false));
  }, [onAvanzar]);

  const cancelExplain = useMemo(
    () =>
      cancelCitaGate
        ? explainMesaShowCancelCitaOperativa({
            kind: cancelCitaGate.kind,
            mockRole: cancelCitaGate.mockRole,
            sessionRole: cancelCitaGate.sessionRole,
            submittedToMesa: cancelCitaGate.submittedToMesa,
            subestado: cancelCitaGate.subestado,
            cicloEstado: cancelCitaGate.cicloEstado,
            etapaActual: cancelCitaGate.etapaActual,
            hasActiveBooking: cancelCitaGate.hasActiveBooking,
            fechaCita: cancelCitaGate.fechaCita,
          })
        : null,
    [cancelCitaGate],
  );

  const showCancelPanel = Boolean(
    cancelCitaGate && cancelExplain?.visible && puedeOperar,
  );

  const cancelLabel =
    cancelCitaGate?.kind === "firmas"
      ? MESA_CANCEL_FIRMAS_BUTTON_LABEL
      : cancelCitaGate?.kind === "notificacion"
        ? MESA_CANCEL_NOTIFICACION_BUTTON_LABEL
        : MESA_CANCEL_BIO_BUTTON_LABEL;

  if (!view.mostrar) return null;

  const titulo = copy.titulo ?? MESA_DECISION_TITULO_AVANCE;

  return (
    <>
      <section
        className="overflow-hidden rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/40 to-white shadow-sm"
        aria-label="Avance operativo Mesa"
        data-mesa-cancel-visible={showCancelPanel ? "true" : "false"}
        data-mesa-cancel-failed={
          cancelExplain && !cancelExplain.visible
            ? cancelExplain.failedChecks.join(",")
            : undefined
        }
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
              {mostrarAtajoMovimientoManual ? (
                <div
                  className="mt-2 border-t border-amber-200 pt-2"
                  data-testid="mesa-atajo-movimiento-manual"
                >
                  <p className="text-xs">{MESA_ATAJO_MOVIMIENTO_MANUAL_TEXTO}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 text-xs"
                    onClick={() =>
                      document
                        .getElementById(MESA_MOVIMIENTO_MANUAL_ANCHOR_ID)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  >
                    Ir al movimiento manual de Mesa
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {showCancelPanel ? (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3"
              data-testid="mesa-decision-cancel-cita"
            >
              {cancelCitaGate?.success ? (
                <p
                  role="status"
                  className="text-sm font-medium text-amber-950"
                >
                  {cancelCitaGate.success}
                </p>
              ) : (
                <>
                  <p className="text-xs text-amber-950">
                    Si el cliente no puede asistir, cancela la cita y permite que el
                    asesor reagende.
                  </p>
                  {cancelCitaGate?.cancelledMotivo ? (
                    <p className="mt-2 text-xs text-amber-900">
                      <span className="font-medium">Motivo para el asesor:</span>{" "}
                      {cancelCitaGate.cancelledMotivo}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full text-xs sm:w-auto"
                    onClick={cancelCitaGate?.onRequest}
                  >
                    {cancelLabel}
                  </Button>
                </>
              )}
            </div>
          ) : null}

          {DEBUG_MESA_CANCEL &&
          cancelCitaGate &&
          cancelExplain &&
          !cancelExplain.visible &&
          puedeOperar ? (
            <p
              className="rounded border border-dashed border-gray-300 bg-gray-50 px-2 py-1 font-mono text-[10px] text-gray-600"
              data-testid="mesa-cancel-gate-debug"
            >
              cancel gate: {cancelExplain.failedChecks.join(", ") || "ok"} · rol=
              {cancelExplain.resolvedRole ?? "null"}
            </p>
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

          {puedeOperar && mostrarBotonAvanzar && copy.etiquetaBoton ? (
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

      {confirmOpen && mostrarBotonAvanzar && copy.etiquetaBoton ? (
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
