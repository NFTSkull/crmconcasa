"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { setTelefonoCasaDraft } from "@/domain/expediente-cliente-datos/telefono-casa-draft-store";

type Props = Readonly<{
  expedienteId: string;
  canEdit: boolean;
}>;

function filterTelefonoCasaInput(input: string): string {
  return String(input ?? "").replace(/\D/g, "").slice(0, 10);
}

export function AsesorTelefonoCasaSection({ expedienteId, canEdit }: Props) {
  const [telefonoCasa, setTelefonoCasa] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTelefono = useCallback(async () => {
    if (!supabaseBrowser || !expedienteId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabaseBrowser
        .from("expedientes")
        .select("telefono_casa")
        .eq("id", expedienteId)
        .maybeSingle();
      if (queryError) throw queryError;
      const value = filterTelefonoCasaInput(String(data?.telefono_casa ?? ""));

      setTelefonoCasa(value);
      setTelefonoCasaDraft(expedienteId, value);
    } catch {
      setError("No se pudo cargar el teléfono de casa.");
    } finally {
      setLoading(false);
    }
  }, [expedienteId]);

  useEffect(() => {
    void loadTelefono();
  }, [loadTelefono]);

  useEffect(() => {
    const handler = (event: Event) => {
      const changedId = (event as CustomEvent<{ expedienteId?: string }>).detail
        ?.expedienteId;
      if (changedId && String(changedId) !== String(expedienteId)) return;
      void loadTelefono();
    };
    window.addEventListener("expediente_cliente_datos_updated", handler);
    return () => {
      window.removeEventListener("expediente_cliente_datos_updated", handler);
    };
  }, [expedienteId, loadTelefono]);

  if (!supabaseBrowser) return null;

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
        value={telefonoCasa}
        disabled={!canEdit || loading}
        inputMode="numeric"
        maxLength={10}
        required
        aria-required="true"
        onChange={(e) => {
          const value = filterTelefonoCasaInput(e.target.value);
          setTelefonoCasa(value);
          setTelefonoCasaDraft(expedienteId, value);
          setError(null);
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
