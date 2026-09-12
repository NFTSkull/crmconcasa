"use client";

import { useEffect, useMemo, useState } from "react";

import { useSessionRepo } from "@/domain/session";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

type TeamTarget = Readonly<{
  id: string;
  full_name?: string | null;
  email: string;
}>;

type ReassignContext = Readonly<{
  can_reassign: boolean;
  team_id?: string;
  team_name?: string | null;
  current_owner?: TeamTarget | null;
  targets?: TeamTarget[];
}>;

function targetLabel(target: TeamTarget): string {
  const name = String(target.full_name ?? "").trim();
  return name ? `${name} · ${target.email}` : target.email;
}

export function AsesorReassignTeamExpedienteFloating({
  expedienteId,
}: Readonly<{ expedienteId: string }>) {
  const { currentUser } = useSessionRepo();
  const [ctx, setCtx] = useState<ReassignContext | null>(null);
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSilvia =
    String(currentUser?.email ?? "").trim().toLowerCase() ===
    "silvia.reyes@concasa.mx";

  useEffect(() => {
    if (!isSilvia || !expedienteId || !isSupabaseConfigured() || !supabaseBrowser) {
      setCtx(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const { data, error: rpcError } = await supabaseBrowser.rpc(
          "asesor_reassign_team_context",
          { p_expediente_id: expedienteId },
        );
        if (rpcError) throw rpcError;
        if (cancelled) return;

        const parsed = (data ?? null) as ReassignContext | null;
        if (!parsed?.can_reassign) {
          setCtx(null);
          return;
        }
        setCtx(parsed);
      } catch (err) {
        if (!cancelled) {
          setCtx(null);
          setError(err instanceof Error ? err.message : "No se pudo cargar la reasignación.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expedienteId, isSilvia]);

  const targets = useMemo(
    () => (ctx?.targets ?? []).filter((target) => target.id !== ctx?.current_owner?.id),
    [ctx],
  );

  if (!isSilvia || loading || !ctx?.can_reassign || targets.length === 0) {
    return null;
  }

  async function handleReassign() {
    if (!targetId || !supabaseBrowser) return;
    const target = targets.find((item) => item.id === targetId);
    if (!target) return;

    const currentLabel = ctx.current_owner ? targetLabel(ctx.current_owner) : "el asesor actual";
    const confirmed = window.confirm(
      `¿Cambiar el titular de este expediente de ${currentLabel} a ${targetLabel(target)}?\n\nSe conservarán documentos, datos, etapa, citas e historial.`,
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabaseBrowser.rpc(
        "asesor_reassign_team_expediente",
        {
          p_expediente_id: expedienteId,
          p_target_asesor_id: targetId,
        },
      );
      if (rpcError) throw rpcError;
      const result = (data ?? null) as { ok?: boolean } | null;
      if (!result?.ok) throw new Error("No se confirmó la reasignación.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el asesor.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {open ? (
        <div className="w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-indigo-200 bg-white p-4 shadow-2xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Cambiar asesor titular</p>
              <p className="mt-1 text-xs text-gray-600">
                Equipo: {ctx.team_name || "Equipo Silvia"}. El expediente no se recrea y conserva toda su información.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          <div className="mb-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">
            Titular actual: <strong>{ctx.current_owner ? targetLabel(ctx.current_owner) : "—"}</strong>
          </div>

          <label className="block text-xs font-medium text-gray-700" htmlFor="team-reassign-target">
            Nuevo asesor titular
          </label>
          <select
            id="team-reassign-target"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={saving}
            className="mt-1 min-h-[44px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Selecciona un asesor…</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {targetLabel(target)}
              </option>
            ))}
          </select>

          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
            Se conservan documentos, Datos Generales, precalificación, etapa, citas e historial. La reasignación queda auditada a nombre de Silvia.
          </p>

          {error ? (
            <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void handleReassign()}
            disabled={!targetId || saving}
            className="mt-3 min-h-[44px] w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Cambiando asesor…" : "Confirmar cambio de asesor"}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setError(null);
          setTargetId("");
          setOpen((value) => !value);
        }}
        className="min-h-[44px] rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-indigo-700"
        data-testid="asesor-reassign-team-expediente-button"
      >
        Cambiar asesor
      </button>
    </div>
  );
}
