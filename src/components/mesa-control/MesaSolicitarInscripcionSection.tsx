"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  canMesaSolicitarInscripcion,
  inscripcionRequirementStatusLabel,
  isInscripcionRequirementOpen,
  useAgendaInscripcionRepo,
  type AgendaInscripcionRequirement,
} from "@/domain/agenda-inscripcion";
import { SupabaseAgendaInscripcionRepo } from "@/domain/agenda-inscripcion/supabase.repo";

export type MesaSolicitarInscripcionSectionProps = Readonly<{
  expedienteId: string;
  etapaActual: number | null | undefined;
  submittedToMesa: boolean;
  cicloActivo: boolean;
  subestado: string | null | undefined;
  /** Roles Mesa/super_admin ya filtrados por el padre. */
  canAct: boolean;
  onUpdated?: () => void;
}>;

export function MesaSolicitarInscripcionSection({
  expedienteId,
  etapaActual,
  submittedToMesa,
  cicloActivo,
  subestado,
  canAct,
  onUpdated,
}: MesaSolicitarInscripcionSectionProps) {
  const repoHook = useAgendaInscripcionRepo();
  const repo =
    repoHook instanceof SupabaseAgendaInscripcionRepo
      ? repoHook
      : (repoHook as SupabaseAgendaInscripcionRepo | null);
  const [requirement, setRequirement] =
    useState<AgendaInscripcionRequirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    if (!repo) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const req = await repo.getOpenRequirement(expedienteId);
      setRequirement(req);
    } catch {
      setRequirement(null);
    } finally {
      setLoading(false);
    }
  }, [repo, expedienteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!repo || !canAct) return null;
  if (loading) {
    return (
      <p className="text-xs text-slate-500" data-testid="mesa-inscripcion-loading">
        Cargando inscripción…
      </p>
    );
  }

  const openReq =
    requirement && isInscripcionRequirementOpen(requirement.status)
      ? requirement
      : null;

  const elegible = canMesaSolicitarInscripcion({
    etapaActual,
    submittedToMesa,
    cicloActivo,
    subestado,
    openRequirement: openReq,
  });

  const handleSubmit = async () => {
    if (busyRef.current || !repo?.mesaSolicitar) return;
    const trimmed = motivo.trim();
    if (!trimmed) {
      setError("El motivo es obligatorio.");
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await repo.mesaSolicitar({
        expedienteId,
        motivo: trimmed,
      });
      if (!result.ok) {
        setError(result.message ?? "No se pudo solicitar.");
        return;
      }
      setSuccess("Se solicitó la cita de inscripción al asesor.");
      setOpen(false);
      setMotivo("");
      await reload();
      onUpdated?.();
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  };

  return (
    <div
      className="mt-3 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2"
      data-testid="mesa-solicitar-inscripcion"
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-teal-900">
        Inscripción
      </h4>

      {openReq ? (
        <p className="mt-1 text-sm text-teal-950">
          {inscripcionRequirementStatusLabel(openReq.status)}
        </p>
      ) : elegible ? (
        <p className="mt-1 text-xs text-teal-900">
          Solicita al asesor que agende la cita de inscripción (hora fija 11:00
          AM). No cambia la etapa del expediente.
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-600">
          No hay acción de inscripción disponible para este expediente.
        </p>
      )}

      {success ? (
        <p className="mt-1 text-xs font-medium text-emerald-800">{success}</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {elegible && !open ? (
        <Button
          type="button"
          className="mt-2"
          variant="secondary"
          onClick={() => {
            setOpen(true);
            setError(null);
            setSuccess(null);
          }}
        >
          Solicitar cita de inscripción
        </Button>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-2 rounded-md border border-teal-200 bg-white p-3">
          <p className="text-xs text-teal-900">
            El asesor recibirá una tarea para agendar la cita de inscripción del
            cliente.
          </p>
          <label className="block text-xs font-medium text-teal-950">
            Motivo *
            <textarea
              className="mt-1 w-full rounded-md border border-teal-200 px-2 py-1.5 text-sm"
              rows={3}
              maxLength={500}
              placeholder="Falla de sistema durante la inscripción"
              value={motivo}
              disabled={saving}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={saving || !motivo.trim()}
              onClick={() => void handleSubmit()}
            >
              {saving ? "Enviando…" : "Confirmar solicitud"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cerrar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
