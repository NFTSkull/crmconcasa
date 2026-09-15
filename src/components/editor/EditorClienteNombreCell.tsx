"use client";

import { useState } from "react";

import { isPorCapturarNombre } from "@/components/editor/editor-cliente-nombre";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Props = {
  expedienteId: string;
  clienteNombre: string;
  onApplied: (nombre: string) => void;
};

/**
 * Contenido de la celda Cliente (sin &lt;td&gt;): texto plano, o input si
 * el nombre es exactamente POR CAPTURAR → RPC editor_fill_nombre_infonavit.
 */
export function EditorClienteNombreCell({
  expedienteId,
  clienteNombre,
  onApplied,
}: Props) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (!isPorCapturarNombre(clienteNombre)) {
    return (
      <span className="truncate" title={clienteNombre || undefined}>
        {clienteNombre || "—"}
      </span>
    );
  }

  async function commit() {
    const nombre = draft.trim();
    if (!nombre || saving) return;
    if (!supabaseBrowser) {
      setAviso("No se pudo aplicar");
      return;
    }
    setSaving(true);
    setAviso(null);
    try {
      const { data, error } = await supabaseBrowser.rpc(
        "editor_fill_nombre_infonavit",
        {
          p_expediente_id: expedienteId,
          p_nombre_completo: nombre,
        },
      );
      const ok =
        !error &&
        data != null &&
        typeof data === "object" &&
        (data as { ok?: unknown }).ok === true;
      if (!ok) {
        setAviso("No se pudo aplicar");
        return;
      }
      onApplied(nombre);
      setDraft("");
    } catch {
      setAviso("No se pudo aplicar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-[10rem]">
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
          className="min-h-[32px] w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-gray-900 outline-none focus:border-amber-500"
          onChange={(e) => setDraft(e.target.value)}
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
        <span className="mt-1 block text-[10px] text-red-600">{aviso}</span>
      ) : null}
    </div>
  );
}
