"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  buildMesaRechazoOperativoAbiertoModel,
  useExpedientesRepo,
} from "@/domain/expedientes";

type Props = {
  expedienteId: string;
  abierto: boolean;
  actorCanReactivar?: boolean;
  dataModeSupabase?: boolean;
  onReactivado?: () => void;
};

/** P204-C: bloqueo visible en detalle Mesa mientras el rechazo operativo sigue abierto. */
export function MesaRechazoOperativoAbiertoBanner({
  expedienteId,
  abierto,
  actorCanReactivar = true,
  dataModeSupabase = false,
  onReactivado,
}: Props) {
  const repo = useExpedientesRepo();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = buildMesaRechazoOperativoAbiertoModel({
    abierto,
    actorCanReactivar,
  });

  if (!model) return null;

  const puedeReactivar =
    dataModeSupabase &&
    model.showReactivarCta &&
    Boolean(expedienteId) &&
    typeof onReactivado === "function";

  const reactivar = async () => {
    if (!puedeReactivar || saving) return;
    const ok = window.confirm(
      "¿Confirmas reactivar este expediente? Conserva la misma etapa; el historial de rechazo no se borra. Validar documentos no cierra el rechazo operativo.",
    );
    if (!ok) return;

    setSaving(true);
    setError(null);
    try {
      await repo.reactivarExpedienteRechazado(expedienteId);
      onReactivado?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo reactivar el expediente.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="mesa-rechazo-operativo-abierto-banner"
      className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 shadow-sm"
      role="status"
    >
      <p className="text-sm font-semibold text-red-950">{model.title}</p>
      <p className="mt-1 text-xs text-red-900">{model.subtitle}</p>
      <p className="mt-2 text-xs font-medium text-red-800">{model.docNote}</p>
      {puedeReactivar ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => void reactivar()}
            data-testid="mesa-reactivar-expediente"
          >
            {saving ? "Reactivando…" : model.ctaLabel}
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
