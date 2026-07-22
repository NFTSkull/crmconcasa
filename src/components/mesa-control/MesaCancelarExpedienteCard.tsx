"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  esElegibleCancelacionOperativa,
  MESA_CANCELACION_OPERATIVA_ANCHOR_ID,
  MESA_CANCELACION_OPERATIVA_CARD_BADGE,
  MESA_CANCELACION_OPERATIVA_CARD_CTA,
  MESA_CANCELACION_OPERATIVA_CARD_INTRO,
  MESA_CANCELACION_OPERATIVA_CARD_TITLE,
  useExpedientesRepo,
} from "@/domain/expedientes";

type Props = {
  expedienteId: string;
  cicloEstado: string | null;
  submittedToMesa: boolean;
  dataModeSupabase: boolean;
  onUpdated: () => void;
};

export function MesaCancelarExpedienteCard({
  expedienteId,
  cicloEstado,
  submittedToMesa,
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

  const visible = esElegibleCancelacionOperativa({
    dataModeSupabase,
    submittedToMesa,
    cicloEstado,
  });

  if (!visible) return null;

  const guardar = async () => {
    if (!confirmado) {
      setError("Confirma que el cliente no continuará el trámite.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await repo.cancelarExpedienteOperativo(expedienteId, {
        motivo,
        comentario: comentario || null,
      });
      setOpen(false);
      onUpdated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo registrar la cancelación operativa.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id={MESA_CANCELACION_OPERATIVA_ANCHOR_ID}
      data-testid="mesa-cancelacion-operativa"
      className="scroll-mt-4 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4 shadow-md ring-2 ring-emerald-200"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white">
          {MESA_CANCELACION_OPERATIVA_CARD_BADGE}
        </span>
        <h2 className="text-sm font-semibold text-emerald-950">
          {MESA_CANCELACION_OPERATIVA_CARD_TITLE}
        </h2>
      </div>
      <p className="mt-2 text-xs font-medium text-emerald-950">
        {MESA_CANCELACION_OPERATIVA_CARD_INTRO}
      </p>
      <p className="mt-1 text-xs text-emerald-900">
        Distinto del rechazo operativo (etapas 5/6). Es terminal: el cliente no
        continuará y no hay reingreso en este flujo. Las citas históricas no se
        cancelan solas.
      </p>
      {!open ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 border-emerald-600 bg-white text-emerald-900 hover:bg-emerald-100"
          onClick={() => setOpen(true)}
        >
          {MESA_CANCELACION_OPERATIVA_CARD_CTA}
        </Button>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-800 sm:col-span-2">
            Motivo de la cancelación
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-emerald-300 px-3 py-2 text-sm"
              placeholder="Ej. Cliente desistió del crédito"
              data-testid="mesa-cancelacion-motivo"
            />
          </label>
          <label className="text-xs font-medium text-gray-800 sm:col-span-2">
            Comentario (opcional)
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full rounded-md border border-emerald-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-start gap-2 text-xs text-emerald-950 sm:col-span-2">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
              className="mt-0.5"
              data-testid="mesa-cancelacion-confirmar"
            />
            <span>
              Confirmo que el cliente no continuará y que esta acción es
              terminal (sin reapertura en este flujo).
            </span>
          </label>
          {error ? (
            <p
              role="alert"
              className="text-xs text-red-700 sm:col-span-2"
              data-testid="mesa-cancelacion-error"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              type="button"
              className="bg-emerald-700 hover:bg-emerald-800 focus:ring-emerald-600"
              disabled={saving || !motivo.trim()}
              onClick={() => void guardar()}
              data-testid="mesa-cancelacion-guardar"
            >
              {saving ? "Cancelando…" : "Confirmar cancelación terminal"}
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
      )}
    </section>
  );
}
