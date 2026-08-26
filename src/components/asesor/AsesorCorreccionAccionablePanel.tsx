"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ASESOR_CORRECCION_PANEL_ID,
  ASESOR_SECCION_DG_ID,
} from "@/domain/expedientes/asesor-expediente-correccion-ui";
import {
  buildAsesorCorreccionViewFromDetalle,
  correccionItemCtaLabel,
  correccionItemFocusId,
  correccionItemLocalStatusLabel,
  type AsesorCorreccionDetalle,
} from "@/domain/expedientes/asesor-correccion-detalle";

type Props = {
  detalle: AsesorCorreccionDetalle | null;
  estadoEfectivo: string | null | undefined;
  onFocusSection?: (focusId: string) => void;
  onResubmit?: () => Promise<void>;
  resubmitting?: boolean;
  formatDateTime?: (iso: string) => string;
};

export function AsesorCorreccionAccionablePanel({
  detalle,
  estadoEfectivo,
  onFocusSection,
  onResubmit,
  resubmitting = false,
  formatDateTime,
}: Props) {
  const view = buildAsesorCorreccionViewFromDetalle(detalle, estadoEfectivo);
  const [confirmAck, setConfirmAck] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleResubmitClick = useCallback(() => {
    if (!view.canResubmit || resubmitting) return;
    if (view.needsDgConfirmation && !confirmAck) return;
    setConfirmOpen(true);
  }, [confirmAck, resubmitting, view.canResubmit, view.needsDgConfirmation]);

  const handleConfirmResubmit = useCallback(async () => {
    setConfirmOpen(false);
    await onResubmit?.();
  }, [onResubmit]);

  if (!view.showPanel) return null;

  const isEnviada =
    estadoEfectivo === "correccion_enviada" ||
    view.uxState === "CORRECCION_ENVIADA";

  if (isEnviada) {
    return (
      <section
        id={ASESOR_CORRECCION_PANEL_ID}
        data-testid="asesor-correccion-accionable"
        className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3"
        role="status"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-950">
          Corrección enviada a Mesa
        </p>
        <p className="mt-1 text-xs text-sky-900">
          {view.uxCopy ?? "En espera de revisión por Mesa."}
        </p>
      </section>
    );
  }

  return (
    <section
      id={ASESOR_CORRECCION_PANEL_ID}
      data-testid="asesor-correccion-accionable"
      className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-4"
      role="status"
    >
      <p className="text-sm font-bold uppercase tracking-wide text-amber-950">
        Corrección solicitada por Mesa
      </p>
      {view.requestAt && formatDateTime ? (
        <p className="mt-0.5 text-[11px] text-amber-800">
          Solicitud: {formatDateTime(view.requestAt)}
        </p>
      ) : null}
      {view.uxCopy ? (
        <p className="mt-2 text-xs font-medium text-amber-950">{view.uxCopy}</p>
      ) : null}

      {view.items.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {view.items.map((item) => (
            <li
              key={`${item.type}-${item.key}`}
              className="rounded-md border border-amber-200 bg-white/90 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-950">
                  {item.label}
                </p>
                <span className="text-[10px] font-medium text-amber-800">
                  {correccionItemLocalStatusLabel(item.local_status)}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-amber-900">
                <span className="font-semibold">Motivo de Mesa:</span>
                <br />
                {item.motivo}
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-amber-900 underline"
                onClick={() => onFocusSection?.(correccionItemFocusId(item))}
              >
                {correccionItemCtaLabel(item)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-amber-900">
          Revisa Datos generales, documentos o retención según lo indicado por Mesa.
        </p>
      )}

      {estadoEfectivo === "correccion_requerida" ? (
        <div className="mt-4 border-t border-amber-200 pt-3">
          {view.needsDgConfirmation && view.canResubmit ? (
            <label className="flex items-start gap-2 text-xs text-amber-950">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmAck}
                onChange={(e) => setConfirmAck(e.target.checked)}
                data-testid="asesor-correccion-confirm-ack"
              />
              <span>Confirmo que atendí el motivo indicado por Mesa.</span>
            </label>
          ) : null}

          {view.blockingReasons.length > 0 && !view.canResubmit ? (
            <p className="mt-2 text-xs text-amber-900" role="status">
              {view.blockingReasons[0]}
            </p>
          ) : null}

          <Button
            type="button"
            className="mt-3 w-full sm:w-auto"
            disabled={
              !view.canResubmit ||
              resubmitting ||
              (view.needsDgConfirmation && !confirmAck)
            }
            onClick={handleResubmitClick}
            data-testid="asesor-correccion-reenviar-cta"
          >
            {resubmitting ? "Enviando…" : "REENVIAR CORRECCIÓN A MESA"}
          </Button>
        </div>
      ) : null}

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-reenvio-title"
        >
          <div className="max-w-md rounded-lg bg-white p-4 shadow-lg">
            <p id="confirm-reenvio-title" className="text-sm font-semibold text-gray-900">
              ¿Enviar esta corrección a Mesa?
            </p>
            <p className="mt-2 text-xs text-gray-700">
              Mesa recibirá los cambios guardados para revisión.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={() => void handleConfirmResubmit()}>
                Confirmar envío
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Banner compacto dentro de sección DG. */
export function AsesorCorreccionSeccionDgBanner(props: {
  motivo: string | null | undefined;
  localStatus?: string | null;
}) {
  const motivo = (props.motivo ?? "").trim();
  if (!motivo) return null;
  return (
    <div
      id={`${ASESOR_SECCION_DG_ID}-correccion-banner`}
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
      role="status"
    >
      <p className="font-semibold">Mesa solicitó corregir esta sección</p>
      <p className="mt-1">
        <span className="font-medium">Motivo:</span> {motivo}
      </p>
      {props.localStatus === "corregido_guardado" ? (
        <p className="mt-1 text-amber-800">
          Cambios guardados · Falta reenviar a Mesa.
        </p>
      ) : null}
    </div>
  );
}
