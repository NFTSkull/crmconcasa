"use client";

import type { ClabeBankStatementDetection } from "@/domain/document-extractions/clabe-bank-statement";

export type MesaClabeShadowDetectionPanelProps = Readonly<{
  analyzing: boolean;
  result: ClabeBankStatementDetection | null;
  applied?: boolean;
}>;

/**
 * Solo sugerencia visual. Nunca escribe el valor en el formulario ni muta el draft.
 */
export function MesaClabeShadowDetectionPanel({
  analyzing,
  result,
  applied = false,
}: MesaClabeShadowDetectionPanelProps) {
  return (
    <div
      className="border-b border-gray-100 bg-slate-50 px-3 py-2"
      data-testid="clabe-shadow-detection"
      aria-live="polite"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        Detección automática
      </p>

      {analyzing ? (
        <p className="mt-1 text-xs text-slate-700">
          Buscando CLABE en el Estado de cuenta…
        </p>
      ) : null}

      {!analyzing && result?.status === "detected" ? (
        <div className="mt-1 space-y-1">
          <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-900">
            CLABE detectada
          </span>
          <p
            className="font-mono text-sm font-semibold tracking-wide text-gray-900"
            data-testid="clabe-shadow-detected-value"
          >
            {result.clabe}
          </p>
          <p className="text-[11px] text-slate-600">
            Checksum válido. Verifica que coincida con el documento.
          </p>
          <p className="text-[11px] text-slate-500">
            {applied
              ? "Aplicada automáticamente al formulario desde el Estado de cuenta."
              : "Sugerencia de referencia — no se escribe en el formulario."}
          </p>
        </div>
      ) : null}

      {!analyzing && result?.status === "ambiguous" ? (
        <div className="mt-1 space-y-1">
          <span className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
            Revisión manual
          </span>
          <p className="text-xs text-slate-700">
            Se detectaron varias CLABE posibles. Verifica el Estado de cuenta.
          </p>
          <ul className="list-inside list-disc font-mono text-xs text-gray-800">
            {result.candidates.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!analyzing && result?.status === "not_found" ? (
        <p className="mt-1 text-xs text-slate-700">
          No se detectó una CLABE válida. Verifica el Estado de cuenta
          manualmente.
        </p>
      ) : null}

      {!analyzing && result?.status === "no_text_layer" ? (
        <p className="mt-1 text-xs text-slate-700">
          No se pudo leer automáticamente este Estado de cuenta. Verifica la
          CLABE manualmente.
        </p>
      ) : null}

      {!analyzing && result?.status === "unsupported" ? (
        <p className="mt-1 text-xs text-slate-700">
          No se pudo detectar automáticamente la CLABE. Verifica el Estado de
          cuenta manualmente.
        </p>
      ) : null}
    </div>
  );
}
