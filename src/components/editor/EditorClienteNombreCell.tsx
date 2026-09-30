"use client";

import { useEffect, useState } from "react";

import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  filterPersonNameInput,
  normalizePersonName,
} from "@/lib/clienteDatosFieldFormats";

type Props = {
  expedienteId: string;
  clienteNombre: string;
  onApplied: (nombre: string) => void;
};

function initialNombre(value: string): string {
  const normalized = normalizePersonName(value ?? "");
  if (
    normalized === "POR CAPTURAR" ||
    normalized === "SIN NOMBRE" ||
    normalized === "NOMBRE COMPLETO"
  ) {
    return "";
  }
  return normalized;
}

/**
 * Nombre editable para TODAS las precalificaciones del Editor.
 * Guarda en expedientes.cliente_nombre sin tocar decisión, monto ni notas.
 */
export function EditorClienteNombreCell({
  expedienteId,
  clienteNombre,
  onApplied,
}: Props) {
  const [draft, setDraft] = useState(() => initialNombre(clienteNombre));
  const [saving, setSaving] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialNombre(clienteNombre));
    setAviso(null);
  }, [clienteNombre, expedienteId]);

  async function commit() {
    const nombre = normalizePersonName(draft);
    const current = initialNombre(clienteNombre);
    if (!nombre || saving || nombre === current) return;

    if (!supabaseBrowser) {
      setAviso("No se pudo guardar");
      return;
    }

    setSaving(true);
    setAviso(null);
    try {
      const { data, error } = await supabaseBrowser.rpc(
        "editor_update_precal_field",
        {
          p_expediente_id: expedienteId,
          p_field: "cliente_nombre",
          p_value: nombre,
        },
      );

      const ok =
        !error &&
        data != null &&
        typeof data === "object" &&
        (data as { ok?: unknown }).ok === true;

      if (!ok) {
        setAviso(error?.message || "No se pudo guardar");
        return;
      }

      setDraft(nombre);
      onApplied(nombre);
      setAviso("Guardado");
      window.setTimeout(() => setAviso(null), 1600);
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-[11rem]">
      <input
        type="text"
        value={draft}
        disabled={saving}
        placeholder="Nombre completo"
        aria-label="Capturar nombre del cliente"
        className="min-h-[34px] w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium uppercase text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
        onChange={(e) => setDraft(filterPersonNameInput(e.target.value))}
        onBlur={() => {
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {aviso ? (
        <span
          className={
            aviso === "Guardado"
              ? "mt-1 block text-[10px] font-medium text-green-600"
              : "mt-1 block text-[10px] font-medium text-red-600"
          }
        >
          {aviso === "Guardado" ? "✓ Guardado" : aviso}
        </span>
      ) : null}
    </div>
  );
}
