"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { SupabaseAgendaFirmasBookingRepo } from "./supabase-booking.repo";
import { SupabaseAgendaFirmasConfigRepo } from "./supabase.repo";
import type { AgendaFirmasBookingRepo, AgendaFirmasConfigRepo } from "./repo";

export * from "./repo";
export { AgendaFirmasSupabaseError } from "./supabase.error";
export { mapUpsertAgendaConfigFirmasRpcError } from "./upsert-agenda-config-rpc-error";
export { mapBookFirmasRpcError } from "./book-firmas-rpc-error";
export { mapCancelFirmasRpcError } from "./cancel-firmas-rpc-error";
export { mapReagendarFirmasRpcError } from "./reagendar-firmas-rpc-error";
export {
  getMesaFirmasUiAccess,
  getMesaFirmasErrorCode,
  mapMesaFirmasRpcError,
  mesaBookFirmasInputSchema,
  mesaBookFirmasResponseSchema,
  mesaCancelFirmasInputSchema,
  mesaCancelFirmasResponseSchema,
  mesaReagendarFirmasInputSchema,
  mesaReagendarFirmasResponseSchema,
  type MesaBookFirmasInput,
  type MesaBookFirmasResponse,
  type MesaCancelFirmasInput,
  type MesaCancelFirmasResponse,
  type MesaReagendarFirmasInput,
  type MesaReagendarFirmasResponse,
} from "./mesa-firmas";
export {
  canShowAsesorFirmasSupabaseCard,
  canShowFirmasManageActions,
} from "./firmas-booking-actions";
export { SupabaseAgendaFirmasConfigRepo } from "./supabase.repo";
export { SupabaseAgendaFirmasBookingRepo } from "./supabase-booking.repo";
export {
  AGENDA_BIOMETRICOS_WEEKDAY_OPTIONS as AGENDA_FIRMAS_WEEKDAY_OPTIONS,
  emptyAgendaBiometricosWeeklyConfig as emptyAgendaFirmasWeeklyConfig,
  slugifyAgendaLocationId,
  type AgendaBiometricosWeeklyLocation as AgendaFirmasWeeklyLocation,
  type AgendaBiometricosWeeklyConfig as AgendaFirmasWeeklyConfig,
} from "@/domain/agenda-biometricos/map-agenda-config";
export type {
  HhmmTime,
  YmdDate,
  AgendaBiometricosSlotAvailability as AgendaFirmasSlotAvailability,
} from "@/domain/agenda-biometricos/types";
export {
  buildScheduledAtIso,
  computeWeeklySlotAvailability,
  computeAdvisorSlotAvailability,
  todayYmdInTimezone,
} from "@/domain/agenda-biometricos/weekly-availability";
export { canEditAgendaBiometricosWeeklyConfig as canEditAgendaFirmasWeeklyConfig } from "@/domain/agenda-biometricos";

/** Repo Supabase de config firmas; `null` en modo mock. */
export function useAgendaFirmasConfigRepo(): AgendaFirmasConfigRepo | null {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseAgendaFirmasConfigRepo();
    }
    return null;
  }, []);
}

/** Repo Supabase de reservas firmas; `null` en modo mock. */
export function useAgendaFirmasBookingRepo(): AgendaFirmasBookingRepo | null {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseAgendaFirmasBookingRepo();
    }
    return null;
  }, []);
}
