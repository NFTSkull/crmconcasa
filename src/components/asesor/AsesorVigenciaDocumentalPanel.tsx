"use client";

import type { ExpedienteVigenciaDocumentalEstado } from "@/domain/expedientes/vigencia-documental";

type Props = {
  estado: ExpedienteVigenciaDocumentalEstado;
  onFocusDocs?: () => void;
};

/**
 * Panel P211 — reingreso por vigencia (tramo 3–8 vencido).
 * No menciona biométricos: puede estar en etapas 5–8.
 */
export function AsesorVigenciaDocumentalPanel({ estado, onFocusDocs }: Props) {
  if (!estado.applicable || estado.tracking_unknown) return null;
  if (!estado.vencido) return null;

  const listo = estado.docs_frescos_completos;

  return (
    <section
      data-testid="asesor-vigencia-documental-panel"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <h2 className="text-sm font-semibold tracking-wide">
        REINGRESO POR VIGENCIA
      </h2>
      {listo ? (
        <p className="mt-1 text-sm text-amber-900">
          Reingreso por vigencia listo. Puedes continuar con el trámite.
        </p>
      ) : (
        <p className="mt-1 text-sm text-amber-900">
          Este expediente superó los 45 días de vigencia. Para continuar con el
          trámite actualiza:
        </p>
      )}
      <ul className="mt-2 space-y-1">
        <li>
          {estado.comprobante_fresco ? "✓" : "○"} Comprobante de domicilio
          {estado.comprobante_fresco ? " actualizado" : ""}
        </li>
        <li>
          {estado.estado_cuenta_fresco ? "✓" : "○"} Estado de cuenta
          {estado.estado_cuenta_fresco ? " actualizado" : ""}
        </li>
      </ul>
      {!listo && onFocusDocs ? (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-amber-950 underline"
          onClick={onFocusDocs}
        >
          Ir a documentos
        </button>
      ) : null}
    </section>
  );
}
