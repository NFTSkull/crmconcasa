"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { validateMesaCancelMotivo } from "@/lib/agendaCancelNote";
import {
  MESA_GESTIONAR_CANCELAR_CONTINUAR_CONFIRM,
  canMesaCancelarCitaYContinuar,
  mesaAgendaCancelDialogKindLabel,
  mesaCancelarContinuarDestinoLabel,
} from "@/lib/mesaAgendaCitasUi";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  mesaCancelarCitaYContinuar,
  mesaGestionarCita,
  AgendaBookingDecisionesError,
} from "@/domain/agenda-booking-decisiones";

export type MesaGestionarCitaDialogProps = Readonly<{
  open: boolean;
  entry: MesaAgendaBookingEntry | null;
  /** Rol app/mock del actor (para gate cancelar y continuar). */
  actorRole: string | null;
  canReagendar: boolean;
  canCancel: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onRequestReagendar: (entry: MesaAgendaBookingEntry) => void;
  onCancelSuccess: () => Promise<void> | void;
  onCancelContinueSuccess: () => Promise<void> | void;
  onError: (message: string) => void;
  onSavingChange: (saving: boolean) => void;
}>;

type Step = "menu" | "cancelar" | "continuar";

export function MesaGestionarCitaDialog({
  open,
  entry,
  actorRole,
  canReagendar,
  canCancel,
  saving,
  error,
  onClose,
  onRequestReagendar,
  onCancelSuccess,
  onCancelContinueSuccess,
  onError,
  onSavingChange,
}: MesaGestionarCitaDialogProps) {
  const [step, setStep] = useState<Step>("menu");
  const [motivo, setMotivo] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setStep("menu");
      setMotivo("");
      setValidationError(null);
      inFlightRef.current = false;
    }
  }, [open]);

  const showCancelContinue = useMemo(() => {
    if (!entry) return false;
    return canMesaCancelarCitaYContinuar({
      kind: entry.kind,
      etapaActual: entry.etapaActual,
      status: entry.status,
      role: actorRole,
    });
  }, [actorRole, entry]);

  const destinoLabel = useMemo(() => {
    if (!entry || !showCancelContinue) return "";
    return mesaCancelarContinuarDestinoLabel({
      kind: entry.kind,
      etapaActual: entry.etapaActual,
    });
  }, [entry, showCancelContinue]);

  const handleClose = useCallback(() => {
    if (saving || inFlightRef.current) return;
    onClose();
  }, [onClose, saving]);

  const handleConfirmCancel = useCallback(async () => {
    if (!entry || inFlightRef.current || saving) return;
    const validation = validateMesaCancelMotivo(motivo);
    if (validation) {
      setValidationError(validation);
      return;
    }
    inFlightRef.current = true;
    onSavingChange(true);
    setValidationError(null);
    try {
      await mesaGestionarCita({
        bookingId: entry.bookingId,
        action: "cancelar",
        motivo: motivo.trim(),
      });
      await onCancelSuccess();
      setMotivo("");
      onClose();
    } catch (err) {
      onError(
        err instanceof AgendaBookingDecisionesError
          ? err.message
          : "No se pudo cancelar la cita.",
      );
    } finally {
      inFlightRef.current = false;
      onSavingChange(false);
    }
  }, [
    entry,
    motivo,
    onCancelSuccess,
    onClose,
    onError,
    onSavingChange,
    saving,
  ]);

  const handleConfirmContinue = useCallback(async () => {
    if (!entry || inFlightRef.current || saving || !showCancelContinue) return;
    const validation = validateMesaCancelMotivo(motivo);
    if (validation) {
      setValidationError(validation);
      return;
    }
    inFlightRef.current = true;
    onSavingChange(true);
    setValidationError(null);
    try {
      await mesaCancelarCitaYContinuar({
        bookingId: entry.bookingId,
        motivo: motivo.trim(),
      });
      await onCancelContinueSuccess();
      setMotivo("");
      onClose();
    } catch (err) {
      onError(
        err instanceof AgendaBookingDecisionesError
          ? err.message
          : "No se pudo cancelar y continuar.",
      );
    } finally {
      inFlightRef.current = false;
      onSavingChange(false);
    }
  }, [
    entry,
    motivo,
    onCancelContinueSuccess,
    onClose,
    onError,
    onSavingChange,
    saving,
    showCancelContinue,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open || !entry) return null;

  const kindLabel = mesaAgendaCancelDialogKindLabel(entry.kind);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mesa-gestionar-cita-title"
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="mesa-gestionar-cita-title" className="text-base font-semibold text-gray-900">
          Gestionar cita
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          {kindLabel} · {entry.clienteNombre || "Cliente"}
        </p>

        {step === "menu" ? (
          <div className="mt-4 space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start text-xs"
              disabled={saving || !canReagendar}
              onClick={() => {
                onRequestReagendar(entry);
                onClose();
              }}
            >
              1. Reagendar
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start text-xs text-red-700"
              disabled={saving || !canCancel}
              onClick={() => setStep("cancelar")}
            >
              2. Cancelar cita
            </Button>
            {showCancelContinue ? (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start text-xs text-amber-900"
                disabled={saving}
                onClick={() => setStep("continuar")}
              >
                3. Cancelar cita y continuar
              </Button>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end pt-2">
              <Button type="button" variant="outline" className="text-xs" disabled={saving} onClick={handleClose}>
                Cerrar
              </Button>
            </div>
          </div>
        ) : step === "cancelar" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-gray-600">
              El expediente no cambiará de etapa; el asesor podrá agendar de nuevo.
            </p>
            <label className="block text-xs font-semibold text-gray-800">
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
              <p role="alert" className="text-xs text-red-700">
                {validationError}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="text-xs"
                disabled={saving}
                onClick={() => {
                  setStep("menu");
                  setValidationError(null);
                }}
              >
                Atrás
              </Button>
              <Button
                type="button"
                variant="primary"
                className="text-xs"
                disabled={saving}
                onClick={() => void handleConfirmCancel()}
              >
                {saving ? "Cancelando…" : "Confirmar cancelación"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              {MESA_GESTIONAR_CANCELAR_CONTINUAR_CONFIRM}
            </p>
            <p className="text-xs text-gray-700">
              Destino: <span className="font-semibold">{destinoLabel}</span>
            </p>
            <label className="block text-xs font-semibold text-gray-800">
              Motivo para el asesor
              <textarea
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900"
                rows={3}
                placeholder="Ej. Mesa autoriza continuar sin realizar la cita."
                value={motivo}
                disabled={saving}
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setValidationError(null);
                }}
              />
            </label>
            {validationError ? (
              <p role="alert" className="text-xs text-red-700">
                {validationError}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="text-xs"
                disabled={saving}
                onClick={() => {
                  setStep("menu");
                  setValidationError(null);
                }}
              >
                Atrás
              </Button>
              <Button
                type="button"
                variant="primary"
                className="text-xs"
                disabled={saving}
                onClick={() => void handleConfirmContinue()}
              >
                {saving ? "Procesando…" : "Confirmar cancelar y continuar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
