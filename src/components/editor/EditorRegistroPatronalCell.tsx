"use client";

import { useEffect, useState } from "react";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Props = {
  expedienteId: string;
  registroPatronal: string;
  onApplied: (registro: string) => void;
};

function normalizeRegistro(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Registro patronal editable para todas las precalificaciones.
 * Permite vacío para limpiar un valor incorrecto.
 */
export function EditorRegistroPatronalCell({
  expedienteId,
  registroPatronal,
  onApplied,
}: Props) {
  const [draft, setDraft] = useState(registroPatronal || "");
  const [saving, setSaving] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setDraft(registroPatronal || "");
    setAviso(null);
  }, [registroPatronal]);

  async function commit() {
    if (saving) return;

    const next = normalizeRegistro(draft);
    const current = normalizeRegistro(registroPatronal || "");
    if (next === current) return;

    if (!supabaseBrowser) {
      setAviso("No se pudo guardar");
      return;
    }

    setSaving(true);
    setAviso(null);
    try {
      const { data, error } = await supabaseBrowser.rpc(
        "editor_update_precal_registro_patronal",
        {
          p_expediente_id: expedienteId,
          p_registro_patronal: next,
        },
      );

      const payload =
        data != null && typeof data === "object"
          ? (data as { ok?: unknown; registro_patronal?: unknown })
          : null;

      if (error || payload?.ok !== true) {
        setAviso(error?.message || "No se pudo guardar");
        return;
      }

      const saved =
        typeof payload.registro_patronal === "string"
          ? payload.registro_patronal
          : "";
      setDraft(saved);
      onApplied(saved);
      setAviso("Guardado");
    } catch {
      setAviso("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-[10rem]">
      <input
        type="text"
        value={draft}
        disabled={saving}
        maxLength={80}
        placeholder="Registro patronal"
        aria-label="Capturar registro patronal"
        className="min-h-[32px] w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm uppercase text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
        onChange={(e) => {
          setDraft(e.target.value.toUpperCase());
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
