"use client";

import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import {
  groupBulkAdvancePlanByTransition,
  mesaAgendaKindBulkLabel,
  type BulkAdvancePlan,
} from "@/domain/agenda-calendar/mesa-bulk-actions";

export type MesaAgendaBulkAdvanceConfirmDialogProps = Readonly<{
  open: boolean;
  plan: BulkAdvancePlan | null;
  saving: boolean;
  progressLabel: string | null;
  onClose: () => void;
  onConfirm: () => void;
}>;

export function MesaAgendaBulkAdvanceConfirmDialog({
  open,
  plan,
  saving,
  progressLabel,
  onClose,
  onConfirm,
}: MesaAgendaBulkAdvanceConfirmDialogProps) {
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

  if (!open || !plan) return null;

  const groups = groupBulkAdvancePlanByTransition(plan);
  const eligible = plan.eligibleExpedientes;
  const skipped = plan.skippedExpedientes;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mesa-bulk-advance-title"
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="mesa-bulk-advance-title" className="text-base font-semibold text-gray-900">
          Pasar expedientes a la siguiente etapa
        </h2>

        <dl className="mt-3 grid gap-1 text-sm text-gray-700">
          <div>
            <dt className="inline font-medium">Citas seleccionadas: </dt>
            <dd className="inline tabular-nums">{plan.selectedBookings}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Expedientes únicos: </dt>
            <dd className="inline tabular-nums">{plan.uniqueExpedientes}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Expedientes elegibles: </dt>
            <dd className="inline tabular-nums">{eligible}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Expedientes omitidos: </dt>
            <dd className="inline tabular-nums">{skipped}</dd>
          </div>
        </dl>

        {groups.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-gray-800">Se intentará avanzar:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
              {groups.map((g) => (
                <li key={`${g.kind}-${g.fromStage}-${g.toStage}`}>
                  {g.expedienteCount} expediente{g.expedienteCount === 1 ? "" : "s"} de{" "}
                  {mesaAgendaKindBulkLabel(g.kind)}: etapa {g.fromStage} → {g.toStage}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {skipped > 0 ? (
          <p className="mt-2 text-sm text-amber-800">
            {skipped} expediente{skipped === 1 ? "" : "s"} no{" "}
            {skipped === 1 ? "es" : "son"} elegible{skipped === 1 ? "" : "s"} y no{" "}
            {skipped === 1 ? "será modificado" : "serán modificados"}.
          </p>
        ) : null}

        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-600">
          <li>
            <strong className="font-semibold text-gray-800">no valida Drive</strong>;
          </li>
          <li>no modifica documentos;</li>
          <li>no cancela ni reagenda citas;</li>
          <li>no modifica datos del cliente;</li>
          <li>utiliza las reglas actuales de Mesa.</li>
        </ul>

        {progressLabel ? (
          <p role="status" className="mt-3 text-xs font-medium text-blue-800">
            {progressLabel}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" className="text-xs" disabled={saving} onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            className="text-xs"
            disabled={saving || eligible === 0}
            onClick={onConfirm}
          >
            {saving
              ? "Avanzando…"
              : `Avanzar ${eligible} expediente${eligible === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
