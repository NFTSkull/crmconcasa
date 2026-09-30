"use client";

import { useEffect, useState } from "react";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Field = "registro_patronal" | "empresa";

type Props = {
  expedienteId: string;
  field: Field;
  value: string;
  placeholder: string;
  ariaLabel: string;
  maxLength?: number;
  onApplied: (value: string) => void;
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function EditorPrecalMetadataCell({
  expedienteId,
  field,
  value,
  placeholder,
  ariaLabel,
  maxLength = 200,
  onApplied,
}: Props) {
  const [draft, setDraft] = useState(() => normalize(value ?? ""));
  const [saving, setSaving] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setDraft(normalize(value ?? ""));
    setAviso(null);
  }, [expedienteId, value]);

  async function commit() {
    const next = normalize(draft);
    const current = normalize(value ?? "");
    if (saving || next === current) return;

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
          p_field: field,
          p_value: next,
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

      setDraft(next);
      onApplied(next);
      setAviso("Guardado");
      window.setTimeout(() => setAviso(null), 1600);
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No se pudo guardar");
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
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={maxLength}
        className="min-h-[34px] w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium uppercase text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
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
