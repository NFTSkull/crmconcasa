"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ASESOR_CANCELACION_TRAMITE_INTRO,
  ASESOR_CANCELACION_TRAMITE_TITLE,
  esElegibleCancelacionAsesor,
  useExpedientesRepo,
} from "@/domain/expedientes";

type Props = {
  expedienteId: string;
  cicloEstado: string | null | undefined;
  dataModeSupabase: boolean;
  onUpdated: () => void;
};

export function AsesorCancelarExpedienteCard({
  expedienteId,
  cicloEstado,
  dataModeSupabase,
  onUpdated,
}: Props) {
  const repo = useExpedientesRepo();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [comentario, setComentario] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = esElegibleCancelacionAsesor({
    dataModeSupabase,
    cicloEstado,
  });

  if (!visible) return null;

  const cancelar = async () => {
    if (!confirmado) {
      setError("Confirma que el cliente ya no continuará con el trámite.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await repo.cancelarExpedienteAsesor(expedienteId, {
        motivo,
        comentario: comentario.trim() ? comentario : null,
      });
      setOpen(false);
      setMotivo("");
      setComentario("");
      setConfirmado(false);
      onUpdated();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo cancelar el trámite.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="asesor-cancelar-tramite"
      className="rounded-xl border border-red-200 bg-red-50/70 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-red-950">
            {ASESOR_CANCELACION_TRAMITE_TITLE}
          </h2>
          <p className="mt-1 text-xs text-red-900">
            {ASESOR_CANCELACION_TRAMITE_INTRO}
          </p>
        </div>

        {!open ? (
          <Button
            type="button"
            variant="outline"
            className="border-red-500 bg-white text-red-800 hover:bg-red-100"
            onClick={() => {
              setOpen(true);
              setError(null);
            }}
          >
            Cancelar trámite
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-medium text-gray-800">
            Motivo de cancelación
            <input
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              maxLength={500}
              placeholder="Ej. Cliente ya no está interesado"
              className="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm"
              data-testid="asesor-cancelar-tramite-motivo"
            />
          </label>

          <label className="text-xs font-medium text-gray-800">
            Comentario (opcional)
            <textarea
              value={comentario}
              onChange={(event) => setComentario(event.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="flex items-start gap-2 text-xs text-red-950">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(event) => setConfirmado(event.target.checked)}
              className="mt-0.5"
              data-testid="asesor-cancelar-tramite-confirmar"
            />
            <span>
              Confirmo que el cliente no continuará. El expediente pasará a
              Cancelados y dejará de aparecer como trámite activo.
            </span>
          </label>

          {error ? (
            <p
              role="alert"
              className="text-xs font-medium text-red-700"
              data-testid="asesor-cancelar-tramite-error"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-red-700 hover:bg-red-800 focus:ring-red-600"
              disabled={saving || !motivo.trim()}
              onClick={() => void cancelar()}
              data-testid="asesor-cancelar-tramite-guardar"
            >
              {saving ? "Cancelando…" : "Confirmar cancelación"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                setError(null);
                setConfirmado(false);
              }}
            >
              Volver
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
