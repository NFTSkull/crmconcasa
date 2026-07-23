"use client";

import { useEffect, useState } from "react";
import {
  getOrCreateMesaPresenciaSessionId,
  mesaCloseExpedientePresencia,
  mesaListExpedientesPresencia,
  mesaTouchExpedientePresencia,
} from "@/domain/expedientes/mesa-expediente-presencia";
import {
  MESA_PRESENCIA_HEARTBEAT_MS,
  type MesaPresenciaUser,
} from "@/lib/mesaExpedientePresenciaUi";
import { isDataModeSupabase } from "@/lib/dataMode";

/**
 * Presencia en detalle: touch inmediato + heartbeat 25s + close al desmontar.
 * Misma session_id de pestaña → Strict Mode/remount no duplica filas.
 */
export function useMesaExpedientePresenciaDetalle(
  expedienteId: string | null | undefined,
  enabled: boolean,
): readonly MesaPresenciaUser[] {
  const [users, setUsers] = useState<readonly MesaPresenciaUser[]>([]);

  useEffect(() => {
    const id = String(expedienteId ?? "").trim();
    if (!enabled || !id || !isDataModeSupabase()) {
      setUsers([]);
      return;
    }

    const sessionId = getOrCreateMesaPresenciaSessionId();
    if (!sessionId) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const refreshList = async () => {
      const map = await mesaListExpedientesPresencia([id]);
      if (cancelled) return;
      setUsers(map.get(id)?.users ?? []);
    };

    const touch = async () => {
      await mesaTouchExpedientePresencia(id, sessionId);
      if (!cancelled) await refreshList();
    };

    void touch();
    intervalId = setInterval(() => {
      void touch();
    }, MESA_PRESENCIA_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      void mesaCloseExpedientePresencia(id, sessionId);
    };
  }, [enabled, expedienteId]);

  return users;
}
