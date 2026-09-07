"use client";

import { setTelefonoCasaDraft } from "@/domain/expediente-cliente-datos/telefono-casa-draft-store";

type Props = Readonly<{
  expedienteId: string;
  canEdit: boolean;
  /** Valor controlado por el padre (oficial hidratado o borrador restaurado). */
  value: string;
  /** Error de validación reactivo (casa vacía / igual a celular, etc.). */
  fieldError?: string;
  /** Notifica al padre; también alimenta el Map RPC vía setTelefonoCasaDraft. */
  onTelefonoCasaChange: (value: string) => void;
}>;

function filterTelefonoCasaInput(input: string): string {
  return String(input ?? "").replace(/\D/g, "").slice(0, 10);
}

/**
 * Teléfono de casa controlado: no re-consulta Supabase ni pisa borrador/dirty del padre.
 * Hidratación oficial / restore de draft ocurre en la página del expediente.
 */
export function AsesorTelefonoCasaSection({
  expedienteId,
  canEdit,
  value,
  fieldError,
  onTelefonoCasaChange,
}: Props) {
  const error = fieldError ?? null;

  return (
    <label className="row-start-7 grid min-w-0 gap-1 text-xs text-gray-600 sm:col-start-2 sm:row-start-5">
      <span className="font-medium text-gray-800">
        Teléfono de casa <span className="text-red-600" aria-hidden="true">*</span>
      </span>
      <input
        className={`rounded-md border px-2 py-1 text-sm ${
          error
            ? "border-red-400 bg-red-50/40 ring-1 ring-red-200"
            : "border-gray-300 bg-white"
        }`}
        value={value}
        disabled={!canEdit}
        inputMode="numeric"
        maxLength={10}
        required
        aria-required="true"
        aria-invalid={Boolean(error)}
        onChange={(e) => {
          const next = filterTelefonoCasaInput(e.target.value);
          setTelefonoCasaDraft(expedienteId, next);
          onTelefonoCasaChange(next);
        }}
      />
      {error ? (
        <span className="text-[11px] text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
