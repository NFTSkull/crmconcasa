"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AvanceOperativoEtapaView } from "@/domain/expedientes/mesa-avance-integracion";

export type MesaAvanceOperativoCopy = {
  titulo?: string;
  descripcion: string;
  etiquetaBoton: string;
  mensajeConfirmacion: string;
};

export const MESA_AVANCE_OPERATIVO_2A3_COPY: MesaAvanceOperativoCopy = {
  descripcion:
    "El expediente está en Registro (etapa 2). Confirma el avance a Listo para cita de biométrico (etapa 3). No se requiere cita biométrica agendada en este paso.",
  etiquetaBoton: "Avanzar a Listo para cita de biométrico",
  mensajeConfirmacion:
    "¿Confirmas avanzar este expediente a etapa 3: Listo para cita de biométrico?",
};

export const MESA_AVANCE_OPERATIVO_3A4_COPY: MesaAvanceOperativoCopy = {
  descripcion:
    "El expediente está en Listo para cita de biométrico (etapa 3). Confirma el avance a Cita agendada (biométricos) (etapa 4). Este paso no agenda la cita; el asesor la agenda después, cuando el expediente esté en etapa 4.",
  etiquetaBoton: "Avanzar a Cita agendada (biométricos)",
  mensajeConfirmacion:
    "¿Confirmas avanzar este expediente a etapa 4: Cita agendada (biométricos)?",
};

export const MESA_AVANCE_OPERATIVO_4A5_COPY: MesaAvanceOperativoCopy = {
  titulo: "Avanzar a etapa 5",
  descripcion:
    "Confirma que la cita biométrica está agendada para continuar a resultado biométrico.",
  etiquetaBoton: "Avanzar a etapa 5",
  mensajeConfirmacion: "¿Confirmas avanzar este expediente a etapa 5?",
};

export const MESA_AVANCE_OPERATIVO_5A6_COPY: MesaAvanceOperativoCopy = {
  titulo: "Avanzar a etapa 6",
  descripcion:
    "La cita biométrica ya ocurrió. Confirma el avance a inscripción.",
  etiquetaBoton: "Avanzar a etapa 6",
  mensajeConfirmacion: "¿Confirmas avanzar este expediente a etapa 6?",
};

export const MESA_AVANCE_OPERATIVO_6A7_COPY: MesaAvanceOperativoCopy = {
  titulo: "Avanzar a etapa 7",
  descripcion:
    "El expediente está en inscripción (etapa 6). Confirma el avance a notificación.",
  etiquetaBoton: "Avanzar a etapa 7",
  mensajeConfirmacion: "¿Confirmas avanzar este expediente a etapa 7?",
};

type Props = {
  view: AvanceOperativoEtapaView;
  copy: MesaAvanceOperativoCopy;
  puedeOperar: boolean;
  loading: boolean;
  error: string | null;
  success: string | null;
  onAvanzar: () => Promise<void>;
};

export function MesaAvanceOperativoSection({
  view,
  copy,
  puedeOperar,
  loading,
  error,
  success,
  onAvanzar,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmar = useCallback(() => {
    void onAvanzar().finally(() => setConfirmOpen(false));
  }, [onAvanzar]);

  if (!view.mostrar) return null;

  return (
    <>
      <section
        className="overflow-hidden rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/40 to-white shadow-sm"
        aria-label="Avance operativo Mesa"
      >
        <header className="border-b border-sky-100 bg-white px-4 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {copy.titulo ?? "Avance operativo Mesa"}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">{copy.descripcion}</p>
        </header>

        <div className="space-y-3 p-4">
          {view.bloqueos.length > 0 ? (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
            >
              <p className="font-medium">Requisitos pendientes</p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs">
                {view.bloqueos.map((bloqueo) => (
                  <li key={bloqueo}>{bloqueo}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}

          {success ? (
            <p
              role="status"
              className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-900"
            >
              {success}
            </p>
          ) : null}

          {puedeOperar ? (
            <div className="border-t border-sky-100 pt-3">
              <Button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!view.puedeAvanzar || loading}
              >
                {loading ? "Avanzando…" : copy.etiquetaBoton}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => !loading && setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mesa-avance-operativo-title"
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mesa-avance-operativo-title" className="text-base font-semibold text-gray-900">
              Confirmar avance de etapa
            </h3>
            <p className="mt-2 text-sm text-gray-600">{copy.mensajeConfirmacion}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => setConfirmOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="button" disabled={loading} onClick={() => void handleConfirmar()}>
                {loading ? "Avanzando…" : "Confirmar avance"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
