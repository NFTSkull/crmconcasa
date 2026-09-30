"use client";

import { useEffect, useState } from "react";

import { isPorCapturarNombre } from "@/components/editor/editor-cliente-nombre";
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

/**
 * Nombre editable para TODAS las precalificaciones del Editor.
 * Blur/Enter guarda solo si cambió el valor.
 */
export function EditorClienteNombreCell({
  expedienteId,
  clienteNombre,
  onApplied,
}: Props) {
  const initialValue = isPorCapturarNombre(clienteNombre)
    ? ""
    : clienteNombre || "";
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setDraft(
      isPorCapturarNombre(clienteNombre) ? "" : clienteNombre || "",
    );
    setAviso(null);
  }, [clienteNombre]);

  async function commit() {
    if (saving) return;
    const nombre = normalizePersonName(draft);
    if (!nombre) return;

    const actual = normalizePersonName(
      isPorCapturarNombre(clienteNombre) ? "" : clienteNombre,
    );
    if (nombre === actual) return;

    if (!supabaseBrowser) {
      setAviso("No se pudo guardar");
      return;
    }

    setSaving(true);
    setAviso(null);
    try {
      const { data, error } = await supabaseBrowser.rpc(
        "editor_update_precal_nombre",
        {
          p_expediente_id: expedienteId,
          p_nombre_completo: nombre,
        },
      );
      const payload =
        data != null && typeof data === "object"
          ? (data as { ok?: unknown; nombre_completo?: unknown })
          : null;
      const applied =
        !error &&
        payload?.ok === true &&
        typeof payload.nombre_completo === "string" &&
        payload.nombre_completo.trim().length > 0;

      if (!applied) {
        setAviso(error?.message || "No se pudo guardar");
        return;
      }

      const savedName = String(payload!.nombre_completo);
      setDraft(savedName);
      onApplied(savedName);
      setAviso("Guardado");
    } catch {
      setAviso("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-[11rem]">
      <label className="flex items-center gap-1.5">
        <span
          className="shrink-0 text-gray-400"
          aria-hidden="true"
          title="Editar nombre"
        >
          ✎
        </span>
        <input
          type="text"
          value={draft}
          disabled={saving}
          placeholder="Nombre completo"
          aria-label="Capturar nombre del cliente"
          className="min-h-[32px] w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm uppercase text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
          onChange={(e) => {
            setDraft(filterPersonNameInput(e.target.value));
            setAviso(null);
          }}
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
      </label>
      {aviso ? (
        <span
          className={
            aviso === "Guardado"
              ? "mt-1 block text-[10px] text-green-600"
              : "mt-1 block text-[10px] text-red-600"
          }
        >
          {aviso}
        </span>
      ) : null}
    </div>
  );
}
