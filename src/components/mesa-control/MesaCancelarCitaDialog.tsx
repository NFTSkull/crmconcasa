"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { validateMesaCancelMotivo } from "@/lib/agendaCancelNote";

export type MesaCancelarCitaDialogProps = Readonly<{
  open: boolean;
  kindLabel: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (motivo: string) => Promise<void>;
}>;

export function MesaCancelarCitaDialog({
  open,
  kindLabel,
  saving,
  error,
  onClose,
  onConfirm,
}: MesaCancelarCitaDialogProps) {
  const [motivo, setMotivo] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (saving) return;
    setMotivo("");
    setValidationError(null);
    onClose();
  }, [onClose, saving]);

  const handleConfirm = useCallback(async () => {
    const validationError = validateMesaCancelMotivo(motivo);
    if (validationError) {
      setValidationError(validationError);
      return;
    }
    setValidationError(null);
    await onConfirm(motivo.trim());
    setMotivo("");
  }, [motivo, onConfirm]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mesa-cancelar-cita-title"
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="mesa-cancelar-cita-title" className="text-base font-semibold text-gray-900">
          Cancelar cita y solicitar reagenda
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          {kindLabel}. El expediente no cambiará de etapa; el asesor podrá agendar de nuevo.
        </p>

        <label className="mt-4 block text-xs font-semibold text-gray-800">
          Motivo para el asesor
          <textarea
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900"
            rows={3}
            placeholder="Ej. El cliente no pudo asistir, favor de reagendar."
            value={motivo}
            disabled={saving}
            onChange={(e) => {
              setMotivo(e.target.value);
              setValidationError(null);
            }}
          />
        </label>

        {validationError ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {validationError}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {error}
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
            disabled={saving}
            onClick={() => void handleConfirm()}
          >
            {saving ? "Procesando…" : "Confirmar cancelación"}
          </Button>
        </div>
      </div>
    </div>
  );
}
