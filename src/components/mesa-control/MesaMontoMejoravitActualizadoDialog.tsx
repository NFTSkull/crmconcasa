"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  calculateMontoDifference,
  calculateUpdatedCobro,
  describeMontoDifference,
  formatMoneyMx,
  validateMontoMejoravitUpdate,
  type ExpedienteMontoMejoravitContext,
} from "@/domain/monto-mejoravit-actualizado";

export type MesaMontoMejoravitActualizadoDialogProps = Readonly<{
  open: boolean;
  context: ExpedienteMontoMejoravitContext;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (input: Readonly<{ montoNuevo: number; motivo: string }>) => void;
}>;

export function MesaMontoMejoravitActualizadoDialog({
  open,
  context,
  saving,
  error,
  onClose,
  onConfirm,
}: MesaMontoMejoravitActualizadoDialogProps) {
  const titleId = useId();
  const montoId = useId();
  const motivoId = useId();
  const montoRef = useRef<HTMLInputElement>(null);
  const [montoRaw, setMontoRaw] = useState("");
  const [motivoRaw, setMotivoRaw] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => montoRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const handleClose = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  const preview = useMemo(() => {
    const validation = validateMontoMejoravitUpdate({
      montoNuevoRaw: montoRaw,
      motivoRaw,
      montoVigente: context.montoOperativoVigente,
      porcentajeCobro: context.porcentajeCobro,
    });
    if (!validation.ok) {
      return { validation, cobroNuevo: null as number | null, diff: null as ReturnType<typeof describeMontoDifference> | null };
    }
    const diff = describeMontoDifference(
      calculateMontoDifference(validation.montoNuevo, context.montoOperativoVigente ?? 0),
    );
    const cobroNuevo = calculateUpdatedCobro(
      validation.montoNuevo,
      context.porcentajeCobro!,
      context.cargoFijo,
    );
    return { validation, cobroNuevo, diff };
  }, [montoRaw, motivoRaw, context]);

  const canSubmit =
    preview.validation.ok &&
    !saving &&
    context.porcentajeCobro != null;

  const handleConfirm = () => {
    const validation = validateMontoMejoravitUpdate({
      montoNuevoRaw: montoRaw,
      motivoRaw,
      montoVigente: context.montoOperativoVigente,
      porcentajeCobro: context.porcentajeCobro,
    });
    if (!validation.ok) {
      setLocalError(validation.error);
      return;
    }
    setLocalError(null);
    onConfirm({ montoNuevo: validation.montoNuevo, motivo: validation.motivo });
  };

  if (!open) return null;

  const vigente = context.montoOperativoVigente;
  const confirmLabel =
    preview.validation.ok
      ? `Actualizar a ${formatMoneyMx(preview.validation.montoNuevo)}`
      : "Actualizar monto";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-gray-900">
          Actualizar monto Mejoravit
        </h2>

        <p className="mt-2 text-sm text-gray-700">
          Esta actualización no modifica los Datos Generales ni el monto aprobado
          original. Se actualizará el monto operativo vigente y se recalculará el
          cobro con el porcentaje existente más $3,000.
        </p>

        {context.porcentajeCobro == null ? (
          <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            No existe un porcentaje de cobro registrado. Debe capturarse antes de
            actualizar el monto.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor={montoId} className="block text-sm font-medium text-gray-800">
              Monto nuevo
            </label>
            <input
              ref={montoRef}
              id={montoId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              disabled={saving || context.porcentajeCobro == null}
              value={montoRaw}
              onChange={(e) => {
                setMontoRaw(e.target.value);
                setLocalError(null);
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ej. 200000.00"
            />
          </div>
          <div>
            <label htmlFor={motivoId} className="block text-sm font-medium text-gray-800">
              Motivo de actualización
            </label>
            <textarea
              id={motivoId}
              rows={3}
              maxLength={500}
              disabled={saving || context.porcentajeCobro == null}
              value={motivoRaw}
              onChange={(e) => {
                setMotivoRaw(e.target.value);
                setLocalError(null);
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe el motivo (máx. 500 caracteres)"
            />
            <p className="mt-1 text-xs text-gray-500">
              {motivoRaw.trim().length}/500
            </p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-700 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-gray-500">Monto vigente</dt>
            <dd className="font-medium text-gray-900">
              {vigente != null ? formatMoneyMx(vigente) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Monto nuevo</dt>
            <dd className="font-medium text-gray-900">
              {preview.validation.ok
                ? formatMoneyMx(preview.validation.montoNuevo)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Diferencia</dt>
            <dd className="font-medium text-gray-900">
              {preview.diff ? (
                <span>
                  {preview.diff.signedLabel}
                  <span className="ml-1 text-xs font-normal text-gray-600">
                    ({preview.diff.proseLabel})
                  </span>
                </span>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Porcentaje</dt>
            <dd className="font-medium text-gray-900">
              {context.porcentajeCobro != null
                ? `${context.porcentajeCobro}%`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Cargo fijo</dt>
            <dd className="font-medium text-gray-900">
              {formatMoneyMx(context.cargoFijo)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Cobro actual</dt>
            <dd className="font-medium text-gray-900">
              {context.montoCalculado != null
                ? formatMoneyMx(context.montoCalculado)
                : "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-gray-500">Cobro nuevo estimado</dt>
            <dd className="font-semibold text-gray-900">
              {preview.cobroNuevo != null ? formatMoneyMx(preview.cobroNuevo) : "—"}
            </dd>
          </div>
        </dl>

        {(localError || error) ? (
          <p
            role="alert"
            aria-live="assertive"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {localError ?? error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={handleConfirm}
          >
            {saving ? "Actualizando…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
