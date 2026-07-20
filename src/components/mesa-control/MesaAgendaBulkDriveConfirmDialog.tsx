"use client";

import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import type { BulkDrivePlan } from "@/domain/agenda-calendar/mesa-bulk-actions";
import { formatMesaAgendaDateTime } from "@/lib/mesaAgendaCitasUi";

export type MesaAgendaBulkDriveConfirmDialogProps = Readonly<{
  open: boolean;
  plan: BulkDrivePlan | null;
  saving: boolean;
  progressLabel: string | null;
  onClose: () => void;
  onConfirm: () => void;
}>;

export function MesaAgendaBulkDriveConfirmDialog({
  open,
  plan,
  saving,
  progressLabel,
  onClose,
  onConfirm,
}: MesaAgendaBulkDriveConfirmDialogProps) {
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

  const eligible = plan.eligibleEntries.length;
  const skipped = plan.skipped.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mesa-bulk-drive-title"
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="mesa-bulk-drive-title" className="text-base font-semibold text-gray-900">
          Validar citas en Drive
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          Se validarán <strong className="font-semibold">{eligible}</strong> cita
          {eligible === 1 ? "" : "s"} seleccionada{eligible === 1 ? "" : "s"}.
        </p>
        {skipped > 0 ? (
          <p className="mt-1 text-sm text-amber-800">
            {skipped} cita{skipped === 1 ? "" : "s"} seleccionada{skipped === 1 ? "" : "s"} no{" "}
            {skipped === 1 ? "es" : "son"} elegible{skipped === 1 ? "" : "s"} y no{" "}
            {skipped === 1 ? "será modificada" : "serán modificadas"}.
          </p>
        ) : null}

        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-600">
          <li>marcará Drive como validado;</li>
          <li>registrará fecha y usuario mediante la RPC actual;</li>
          <li>
            <strong className="font-semibold text-gray-800">no avanzará ninguna etapa</strong>;
          </li>
          <li>no modificará documentos ni archivos.</li>
        </ul>

        {eligible > 0 && eligible <= 8 ? (
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700">
            {plan.eligibleEntries.map((e) => (
              <li key={e.bookingId}>
                {e.clienteNombre || "—"} · {formatMesaAgendaDateTime(e)}
              </li>
            ))}
          </ul>
        ) : null}

        {progressLabel ? (
          <p role="status" className="mt-3 text-xs font-medium text-blue-800">
            {progressLabel}
          </p>
        ) : null}

        <p className="mt-3 text-sm text-gray-800">¿Deseas continuar?</p>

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
              ? "Validando…"
              : `Validar ${eligible} cita${eligible === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
