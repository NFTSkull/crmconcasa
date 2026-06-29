"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  MesaOpsSupabaseError,
  useMesaOpsRepo,
  type MesaExpedienteOpsRow,
} from "@/domain/mesa-ops";
import { getEffectiveMockName } from "@/lib/mockUser";
import type { Rol } from "@/domain/session";
import {
  MESA_OPS_RELEASE_SUCCESS_MESSAGE,
  MESA_OPS_TAKE_SUCCESS_MESSAGE,
  resolveMesaOpsAdminCanRelease,
  getMesaOpsStatusKind,
  getMesaOpsStatusLabel,
  isAssignedToCurrentUser,
  isSinAsignarOps,
  mapReleaseResultToOpsRow,
  mapTakeResultToOpsRow,
  mesaOpsStatusBadgeClass,
  mesaOpsTakePromptStorageKey,
} from "@/lib/mesaOpsUi";
import { hasAlertMessage, notifyMesaOpsUpdated } from "@/lib/hasAlertMessage";

type MesaExpedienteOpsSectionProps = Readonly<{
  expedienteId: string;
  currentUserId: string | null;
  sessionRole?: Rol | null;
  appRole?: string | null;
  mockRoleFallback?: string | null;
  ops: MesaExpedienteOpsRow | null;
  onOpsChange: (next: MesaExpedienteOpsRow | null) => void;
}>;

function MesaOpsStatusBadge({
  ops,
  currentUserId,
}: {
  ops: MesaExpedienteOpsRow | null;
  currentUserId: string | null;
}) {
  const kind = getMesaOpsStatusKind(ops, currentUserId);
  const label = getMesaOpsStatusLabel(ops, currentUserId);
  return (
    <span
      className={mesaOpsStatusBadgeClass(kind)}
      data-testid="mesa-ops-status-badge"
    >
      {label}
    </span>
  );
}

export function MesaExpedienteOpsSection({
  expedienteId,
  currentUserId,
  sessionRole = null,
  appRole = null,
  mockRoleFallback = null,
  ops,
  onOpsChange,
}: MesaExpedienteOpsSectionProps) {
  const mesaOpsRepo = useMesaOpsRepo();
  const currentUserName =
    typeof window !== "undefined" ? getEffectiveMockName() : null;

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showTakePrompt, setShowTakePrompt] = useState(false);
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [releaseMotivo, setReleaseMotivo] = useState("");
  const [adminRelease, setAdminRelease] = useState(false);

  const sinAsignar = isSinAsignarOps(ops);
  const assignedToMe = isAssignedToCurrentUser(ops, currentUserId);
  const assignedToOther = Boolean(ops?.assignedTo && !assignedToMe);
  const canAdminRelease =
    assignedToOther &&
    resolveMesaOpsAdminCanRelease({
      appRole,
      sessionRole,
      mockRole: mockRoleFallback,
    });

  useEffect(() => {
    if (!sinAsignar || !mesaOpsRepo || !expedienteId) {
      setShowTakePrompt(false);
      return;
    }
    if (typeof window === "undefined") return;
    const dismissed =
      window.sessionStorage.getItem(mesaOpsTakePromptStorageKey(expedienteId)) ===
      "1";
    setShowTakePrompt(!dismissed);
  }, [sinAsignar, mesaOpsRepo, expedienteId]);

  const dismissTakePrompt = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(mesaOpsTakePromptStorageKey(expedienteId), "1");
    }
    setShowTakePrompt(false);
  }, [expedienteId]);

  const handleTake = useCallback(async () => {
    if (!mesaOpsRepo) return;
    setActionLoading(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = await mesaOpsRepo.takeExpediente(expedienteId);
      const next = mapTakeResultToOpsRow(
        result,
        currentUserName,
        ops,
      );
      onOpsChange(next);
      setSuccessMessage(MESA_OPS_TAKE_SUCCESS_MESSAGE);
      dismissTakePrompt();
      notifyMesaOpsUpdated();
    } catch (err) {
      const message =
        err instanceof MesaOpsSupabaseError
          ? err.message
          : "No se pudo tomar el expediente.";
      setActionError(message);
      if (message.includes("otro usuario")) {
        void mesaOpsRepo.getByExpedienteId(expedienteId).then(onOpsChange);
      }
    } finally {
      setActionLoading(false);
    }
  }, [
    mesaOpsRepo,
    expedienteId,
    currentUserName,
    ops,
    onOpsChange,
    dismissTakePrompt,
  ]);

  const openReleaseDialog = useCallback((asAdmin: boolean) => {
    setAdminRelease(asAdmin);
    setReleaseMotivo("");
    setActionError(null);
    setShowReleaseDialog(true);
  }, []);

  const handleRelease = useCallback(async () => {
    if (!mesaOpsRepo) return;
    const motivo = releaseMotivo.trim();
    if (adminRelease && !motivo) {
      setActionError("El motivo es obligatorio al liberar asignación de otro operador.");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = await mesaOpsRepo.releaseExpediente(
        expedienteId,
        motivo || null,
      );
      onOpsChange(mapReleaseResultToOpsRow(result));
      setSuccessMessage(MESA_OPS_RELEASE_SUCCESS_MESSAGE);
      setShowReleaseDialog(false);
      notifyMesaOpsUpdated();
    } catch (err) {
      setActionError(
        err instanceof MesaOpsSupabaseError
          ? err.message
          : "No se pudo liberar el expediente.",
      );
    } finally {
      setActionLoading(false);
    }
  }, [mesaOpsRepo, expedienteId, releaseMotivo, adminRelease, onOpsChange]);

  const bodyCopy = useMemo(() => {
    if (sinAsignar) {
      return "Este expediente aún no tiene responsable operativo en Mesa.";
    }
    if (assignedToMe) {
      return "Este expediente está marcado como tuyo en Mesa.";
    }
    if (assignedToOther) {
      return "Este expediente ya está siendo trabajado por otro usuario de Mesa.";
    }
    return null;
  }, [sinAsignar, assignedToMe, assignedToOther]);

  if (!mesaOpsRepo) return null;

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="mesa-ops-responsable-section"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Responsable Mesa</h2>
          <p className="mt-1 text-xs text-slate-500">
            Asignación operativa (modo sombra). No bloquea otras acciones.
          </p>
        </div>
        <MesaOpsStatusBadge ops={ops} currentUserId={currentUserId} />
      </div>

      {bodyCopy ? <p className="mt-3 text-sm text-slate-700">{bodyCopy}</p> : null}

      {successMessage ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {successMessage}
        </p>
      ) : null}

      {hasAlertMessage(actionError) && !showReleaseDialog ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {actionError.trim()}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {sinAsignar ? (
          <Button
            type="button"
            disabled={actionLoading}
            onClick={() => void handleTake()}
            data-testid="mesa-ops-tomar-expediente"
          >
            {actionLoading ? "Tomando…" : "Tomar expediente"}
          </Button>
        ) : null}
        {assignedToMe ? (
          <Button
            type="button"
            variant="outline"
            disabled={actionLoading}
            onClick={() => openReleaseDialog(false)}
            data-testid="mesa-ops-liberar-expediente"
          >
            Liberar expediente
          </Button>
        ) : null}
        {canAdminRelease ? (
          <Button
            type="button"
            variant="outline"
            disabled={actionLoading}
            onClick={() => openReleaseDialog(true)}
            data-testid="mesa-ops-liberar-asignacion-admin"
          >
            Liberar asignación
          </Button>
        ) : null}
      </div>

      {showTakePrompt ? (
        <div
          className="mt-4 rounded-lg border border-blue-200 bg-blue-50/80 p-4"
          role="dialog"
          aria-labelledby="mesa-ops-take-prompt-title"
          data-testid="mesa-ops-take-prompt"
        >
          <h3
            id="mesa-ops-take-prompt-title"
            className="text-sm font-semibold text-slate-900"
          >
            ¿Vas a trabajar este expediente?
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            Si lo tomas, quedará marcado como trabajando por ti. Esto no bloquea a
            otros flujos todavía.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={actionLoading}
              onClick={dismissTakePrompt}
            >
              Solo revisar
            </Button>
            <Button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleTake()}
            >
              Tomar expediente
            </Button>
          </div>
        </div>
      ) : null}

      {showReleaseDialog ? (
        <div
          className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
          role="dialog"
          aria-labelledby="mesa-ops-release-title"
        >
          <h3 id="mesa-ops-release-title" className="text-sm font-semibold text-slate-900">
            {adminRelease ? "Liberar asignación" : "Liberar expediente"}
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            {adminRelease
              ? "Indica el motivo de la liberación (obligatorio)."
              : "Puedes indicar un motivo opcional."}
          </p>
          <div className="mt-3">
            <Input
              label={adminRelease ? "Motivo" : "Motivo (opcional)"}
              value={releaseMotivo}
              onChange={(e) => setReleaseMotivo(e.target.value)}
              placeholder={
                adminRelease ? "Ej. reasignación operativa" : "Opcional"
              }
            />
          </div>
          {hasAlertMessage(actionError) ? (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {actionError.trim()}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={actionLoading}
              onClick={() => setShowReleaseDialog(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleRelease()}
            >
              {actionLoading ? "Liberando…" : "Confirmar liberación"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function MesaOpsBandejaBadge({
  ops,
  currentUserId,
}: {
  ops?: MesaExpedienteOpsRow | null;
  currentUserId: string | null;
}) {
  const kind = getMesaOpsStatusKind(ops ?? null, currentUserId);
  const label = getMesaOpsStatusLabel(ops ?? null, currentUserId);
  return (
    <span
      className={mesaOpsStatusBadgeClass(kind)}
      data-testid="mesa-ops-bandeja-badge"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {label}
    </span>
  );
}
