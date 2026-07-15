"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ExpedientesSupabaseError,
  puedeConsultarReingresoPostBiometricos,
  type ExpedienteMock,
  type ReingresoElegibilidad,
  useExpedientesRepo,
} from "@/domain/expedientes";
import { Button } from "@/components/ui/Button";

type Props = {
  expedienteId: string;
  dataModeSupabase: boolean;
  etapaActual: number | null | undefined;
  subestado: string | null | undefined;
  cicloEstado: string | null | undefined;
  reingreso: ExpedienteMock["reingreso"];
};

export function AsesorReingresoPostBiometricosCard({
  expedienteId,
  dataModeSupabase,
  etapaActual,
  subestado,
  cicloEstado,
  reingreso,
}: Props) {
  const repo = useExpedientesRepo();
  const router = useRouter();
  const [eligibilidad, setElegibilidad] =
    useState<ReingresoElegibilidad | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esHijo = Boolean(
    reingreso?.expedienteAnteriorId && reingreso?.rechazoId,
  );
  const debeConsultar = puedeConsultarReingresoPostBiometricos({
    dataModeSupabase,
    etapaActual,
    subestado,
    cicloEstado,
    esHijoReingreso: esHijo,
  });

  useEffect(() => {
    if (!debeConsultar) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void repo
      .getReingresoPostBiometricosElegibilidad(expedienteId)
      .then((value) => {
        if (!cancelled) setElegibilidad(value);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo consultar la elegibilidad.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debeConsultar, expedienteId, repo]);

  if (esHijo) {
    return (
      <section className="rounded-lg border border-violet-300 bg-violet-50 p-4 text-sm text-violet-950">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-violet-700 px-2.5 py-1 text-xs font-semibold text-white">
            Reingreso / Reinscripción
          </span>
          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
            Biométricos reutilizados
          </span>
        </div>
        <p className="mt-3">
          Este expediente continúa desde Inscripción con una nueva aprobación de
          monto y documentos actualizados.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>Nueva decisión del editor pendiente o revalidada.</li>
          <li>Comprobante de domicilio nuevo.</li>
          <li>Estado de cuenta nuevo.</li>
        </ul>
        {reingreso?.expedienteAnteriorId ? (
          <Link
            href={`/asesor/expediente/${reingreso.expedienteAnteriorId}`}
            className="mt-3 inline-block text-xs font-semibold text-violet-800 underline"
          >
            Ver expediente anterior
          </Link>
        ) : null}
      </section>
    );
  }

  if (!debeConsultar) return null;

  const iniciar = async () => {
    if (!eligibilidad?.eligible || creating) return;
    const confirmed = window.confirm(
      "Se cerrará este ciclo y se creará un expediente nuevo en Inscripción. El historial y la cita biométrica anterior permanecerán intactos. ¿Continuar?",
    );
    if (!confirmed) return;
    setCreating(true);
    setError(null);
    try {
      const child = await repo.iniciarReingresoPostBiometricos(expedienteId);
      router.push(`/asesor/expediente/${child.id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ExpedientesSupabaseError || err instanceof Error
          ? err.message
          : "No se pudo iniciar el reingreso.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 className="font-semibold">Reingreso / Reinscripción</h2>
      {loading ? (
        <p className="mt-2 text-xs">Verificando elegibilidad…</p>
      ) : eligibilidad?.eligible ? (
        <>
          <p className="mt-2 text-xs">
            Mesa clasificó los biométricos como reutilizables. Se creará un
            expediente hijo sin nueva cita biométrica.
          </p>
          <Button
            type="button"
            variant="primary"
            className="mt-3"
            disabled={creating}
            onClick={() => void iniciar()}
          >
            {creating
              ? "Creando reingreso…"
              : "Iniciar reingreso / reinscripción"}
          </Button>
        </>
      ) : (
        <p className="mt-2 text-xs">
          {eligibilidad?.reason_message ??
            "Este expediente no es elegible para reingreso."}
        </p>
      )}
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
