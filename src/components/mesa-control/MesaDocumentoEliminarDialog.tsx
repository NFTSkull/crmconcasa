"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { MESA_DOCUMENTO_ELIMINAR_CONFIRM } from "@/domain/expediente-archivos/mesa-documentos-operativos";

export type MesaDocumentoEliminarDialogProps = Readonly<{
  open: boolean;
  label: string;
  deleting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}>;

export function MesaDocumentoEliminarDialog({
  open,
  label,
  deleting,
  error,
  onClose,
  onConfirm,
}: MesaDocumentoEliminarDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    if (deleting) return;
    onClose();
  }, [deleting, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => confirmRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            Eliminar {label}
          </h2>
        </div>

        <div className="space-y-3 px-4 py-4 text-sm text-gray-700">
          <p>{MESA_DOCUMENTO_ELIMINAR_CONFIRM}</p>
          <p className="text-xs text-gray-500">
            Esta acción no cambia la etapa ni modifica citas, montos o ingresos.
          </p>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 bg-slate-50 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3 text-sm"
            disabled={deleting}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant="primary"
            className="h-9 px-3 text-sm !bg-red-700 hover:!bg-red-800 focus:!ring-red-600"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting ? "Eliminando…" : "Eliminar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
