"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";

export type ReingresoManualConfirmDialogProps = {
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ReingresoManualConfirmDialog({
  saving = false,
  error = null,
  onCancel,
  onConfirm,
}: ReingresoManualConfirmDialogProps) {
  const titleId = useId();
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
        <h2 id={titleId} className="text-base font-semibold text-gray-900">
          Enviar expediente como reingreso
        </h2>
        <p className="mt-3 text-sm text-gray-700">
          Este mismo expediente se enviará nuevamente a Mesa Control y se identificará
          como REINGRESO. No se creará un expediente nuevo.
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            disabled={saving}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>Confirmo el reingreso de este expediente.</span>
        </label>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || !confirmed}
            onClick={() => void onConfirm()}
          >
            {saving ? "Enviando…" : "Confirmar reingreso"}
          </Button>
        </div>
      </div>
    </div>
  );
}
