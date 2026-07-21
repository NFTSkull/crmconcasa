"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import {
  formatBytesLabel,
  formatNotificacionDocumentoMimeLabel,
  type ClienteNotificacionMime,
} from "@/domain/expediente-archivos/cliente-notificacion";

export type MesaNotificacionDocumentoUploadDialogMode = "upload" | "replace";

export type MesaNotificacionDocumentoUploadDialogProps = Readonly<{
  open: boolean;
  mode: MesaNotificacionDocumentoUploadDialogMode;
  fileName: string;
  mime: ClienteNotificacionMime | string;
  fileSize: number;
  saving: boolean;
  progressLabel: string | null;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}>;

export function MesaNotificacionDocumentoUploadDialog({
  open,
  mode,
  fileName,
  mime,
  fileSize,
  saving,
  progressLabel,
  error,
  onClose,
  onConfirm,
}: MesaNotificacionDocumentoUploadDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

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

  const isReplace = mode === "replace";
  const title = isReplace ? "Reemplazar Notificación" : "Subir Notificación";
  const confirmLabel = isReplace ? "Reemplazar Notificación" : "Subir Notificación";

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
            {title}
          </h2>
        </div>

        <div className="space-y-3 px-4 py-4 text-sm text-gray-700">
          {isReplace ? (
            <p>
              Se cargará una nueva versión del Notificación. La versión vigente anterior se
              conservará en el historial documental interno y dejará de mostrarse como
              documento activo.
            </p>
          ) : (
            <p>Se cargará este archivo al expediente:</p>
          )}

          <dl className="rounded-lg border border-gray-100 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex justify-between gap-2 py-1">
              <dt className="text-gray-500">Archivo</dt>
              <dd className="min-w-0 truncate font-medium text-gray-900">{fileName}</dd>
            </div>
            <div className="flex justify-between gap-2 py-1">
              <dt className="text-gray-500">Formato</dt>
              <dd className="font-medium text-gray-900">{formatNotificacionDocumentoMimeLabel(mime)}</dd>
            </div>
            <div className="flex justify-between gap-2 py-1">
              <dt className="text-gray-500">Tamaño</dt>
              <dd className="font-medium text-gray-900">{formatBytesLabel(fileSize)}</dd>
            </div>
          </dl>

          {!isReplace ? (
            <p className="text-xs text-gray-500">
              El asesor propietario podrá verlo y descargarlo.
            </p>
          ) : null}

          <p className="text-xs text-gray-500">
            Esta acción no cambia la etapa
            {!isReplace ? " ni modifica los Datos Generales" : ""}.
          </p>

          {progressLabel ? (
            <p aria-live="polite" className="text-xs font-medium text-sky-800">
              {progressLabel}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 bg-slate-50 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3 text-sm"
            disabled={saving}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant="primary"
            className="h-9 px-3 text-sm"
            disabled={saving}
            onClick={onConfirm}
          >
            {saving ? "Procesando…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
