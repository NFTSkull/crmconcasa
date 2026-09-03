"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Props = Readonly<{
  expedienteId: string;
  canEdit: boolean;
}>;

function normalizeTelefonoMexico(input: string): string {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

function mapTelefonoCasaError(error: { message?: string; details?: string } | null): string {
  const raw = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  if (
    raw.includes("cliente_datos_celular_igual_telefono_casa") ||
    raw.includes("telefono_casa_duplicado_datos_generales") ||
    raw.includes("cliente_datos_telefono_casa_duplicado")
  ) {
    return "El teléfono de casa no puede repetirse con ningún teléfono de Datos Generales.";
  }
  if (raw.includes("telefono_casa_invalido")) {
    return "El teléfono de casa debe tener exactamente 10 dígitos.";
  }
  if (raw.includes("42501") || raw.includes("no autorizado") || raw.includes("asesor dueño")) {
    return "No tienes permiso para modificar el teléfono de casa de este expediente.";
  }
  return "No se pudo guardar el teléfono de casa. Intenta de nuevo.";
}

export function AsesorTelefonoCasaSection({ expedienteId, canEdit }: Props) {
  const [telefonoCasa, setTelefonoCasa] = useState("");
  const [savedTelefonoCasa, setSavedTelefonoCasa] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
        .select("telefono_cliente")
        .eq("id", expedienteId)
        .maybeSingle();
      if (queryError) throw queryError;
      const value = String(data?.telefono_cliente ?? "").trim();
      setTelefonoCasa(value);
      setSavedTelefonoCasa(value);
    } catch {
      setError("No se pudo cargar el teléfono de casa.");
    } finally {
      setLoading(false);
    }
  }, [expedienteId]);

  useEffect(() => {
    void loadTelefono();
  }, [loadTelefono]);

  const normalized = useMemo(() => normalizeTelefonoMexico(telefonoCasa), [telefonoCasa]);
  const savedNormalized = useMemo(
    () => normalizeTelefonoMexico(savedTelefonoCasa),
    [savedTelefonoCasa],
  );
  const changed = normalized !== savedNormalized;

  const handleSave = async () => {
    if (!supabaseBrowser || !canEdit || saving) return;
    setError(null);
    setSaved(false);
    if (!/^\d{10}$/.test(normalized)) {
      setError("El teléfono de casa debe tener exactamente 10 dígitos.");
      return;
    }

    setSaving(true);
    try {
      const { data, error: rpcError } = await supabaseBrowser.rpc(
        "asesor_actualizar_telefono_casa",
        {
          p_expediente_id: expedienteId,
          p_telefono_casa: normalized,
        },
      );
      if (rpcError) {
        setError(mapTelefonoCasaError(rpcError));
        return;
      }
      const returned =
        data && typeof data === "object" && "telefono_casa" in data
          ? String((data as { telefono_casa?: unknown }).telefono_casa ?? normalized)
          : normalized;
      setTelefonoCasa(returned);
      setSavedTelefonoCasa(returned);
      setSaved(true);
    } catch {
      setError("No se pudo guardar el teléfono de casa. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  if (!supabaseBrowser) return null;

  return (
    <div className="row-start-7 grid min-w-0 gap-1 text-xs text-gray-600 sm:col-start-2 sm:row-start-5">
      <label className="grid gap-1">
        <span className="font-medium text-gray-800">Teléfono de casa</span>
        <div className="flex gap-2">
          <input
            className={`min-w-0 flex-1 rounded-md border px-2 py-1 text-sm ${
              error
                ? "border-red-400 bg-red-50/40 ring-1 ring-red-200"
                : "border-gray-300 bg-white"
            }`}
            value={telefonoCasa}
            disabled={!canEdit || loading || saving}
            inputMode="numeric"
            maxLength={14}
            onChange={(e) => {
              setTelefonoCasa(e.target.value);
              setError(null);
              setSaved(false);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="shrink-0 px-3 text-xs"
            disabled={!canEdit || loading || saving || !changed}
            onClick={() => void handleSave()}
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </label>
      {error ? <span className="text-[11px] text-red-700" role="alert">{error}</span> : null}
      {saved ? <span className="text-[11px] text-emerald-700" role="status">Guardado.</span> : null}
    </div>
  );
}
