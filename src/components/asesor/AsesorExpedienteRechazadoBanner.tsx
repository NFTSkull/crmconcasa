"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  buildAsesorRechazoOperativoBannerModel,
  useExpedientesRepo,
} from "@/domain/expedientes";
import { formatPasoOperativoLabel } from "@/domain/expedientes/etapa-numeracion-ux";

type Props = {
  motivo: string | null | undefined;
  comentario: string | null | undefined;
  etapaActual?: number | null;
  dataModeSupabase?: boolean;
  expedienteId?: string;
  /** Actividad (docs/datos) posterior al rechazo vigente. */
  hasActivityAfterRechazo?: boolean;
  onReenviado?: () => void;
};

/** Banner RO de rechazo operativo en detalle Asesor (P099 / P108A / P204-C). */
export function AsesorExpedienteRechazadoBanner({
  motivo,
  comentario,
  etapaActual,
  dataModeSupabase = false,
  expedienteId,
  hasActivityAfterRechazo = false,
  onReenviado,
}: Props) {
  const repo = useExpedientesRepo();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const motivoTxt = motivo?.trim() || null;
  const notaTxt = comentario?.trim() || null;
  const pasoLabel =
    typeof etapaActual === "number"
      ? formatPasoOperativoLabel(etapaActual)
      : null;

  const model = buildAsesorRechazoOperativoBannerModel({
    abierto: true,
    hasActivityAfterRechazo,
    preferShortCta: true,
  });

  const puedeReenviar =
    dataModeSupabase && Boolean(expedienteId) && typeof onReenviado === "function";

  const reenviar = async () => {
    if (!expedienteId || !puedeReenviar || saving) return;
    const ok = window.confirm(
      "¿Confirmas reenviar este expediente a Mesa? Se conserva la misma etapa; el historial de rechazo no se borra. Guardar documentos no cierra el rechazo: esta acción sí.",
    );
    if (!ok) return;

    setSaving(true);
    setError(null);
    try {
      await repo.reactivarExpedienteRechazado(expedienteId);
      onReenviado?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo reenviar el expediente a Mesa.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!model) return null;

  return (
    <section
      data-testid="asesor-expediente-rechazado-banner"
      className="rounded-xl border border-red-300 bg-red-50 px-4 py-3"
      role="status"
    >
      <p className="text-sm font-semibold text-red-950">{model.title}</p>
      <p className="mt-1 text-xs text-red-900">{model.body}</p>
      {model.showActivityHint ? (
        <p
          className="mt-2 rounded-md border border-red-200 bg-white/70 px-3 py-2 text-xs text-red-950"
          data-testid="asesor-rechazo-falta-reenviar"
        >
          <span className="font-semibold">{model.activityPrimary}</span>
          {" · "}
          <span className="font-semibold text-red-800">
            {model.activitySecondary}
          </span>
        </p>
      ) : null}
      {pasoLabel ? (
        <p className="mt-2 text-xs font-medium text-red-950" data-testid="asesor-rechazo-paso">
          {pasoLabel}
        </p>
      ) : null}
      <dl className="mt-3 grid gap-1 text-xs text-red-950 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="font-medium text-red-800">Motivo</dt>
          <dd data-testid="asesor-rechazo-motivo">
            {motivoTxt ?? "Sin motivo registrado"}
          </dd>
        </div>
        {notaTxt ? (
          <div className="sm:col-span-2">
            <dt className="font-medium text-red-800">Nota para el asesor</dt>
            <dd data-testid="asesor-rechazo-nota">{notaTxt}</dd>
          </div>
        ) : null}
      </dl>
      {puedeReenviar ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            onClick={() => void reenviar()}
            data-testid="asesor-corregir-reenviar-mesa"
          >
            {saving ? "Reenviando…" : model.ctaLabel}
          </Button>
          {error ? (
            <p
              role="alert"
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-2 text-xs text-red-800"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
