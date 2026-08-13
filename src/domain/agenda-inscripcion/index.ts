"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { SupabaseAgendaInscripcionRepo } from "./supabase.repo";
import type { AgendaInscripcionRepo } from "./repo";

export {
  INSCRIPCION_FIXED_TIME,
  INSCRIPCION_FIXED_TIME_DISPLAY,
  INSCRIPCION_BOOKING_KIND,
  GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED,
  GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE,
} from "./constants";

export { detectInscripcionRebookRequirement } from "./detect-rebook";

export {
  isInscripcionRequirementsEnabled,
  parseInscripcionRequirementsFromDate,
} from "./env-gate";
export {
  evaluateInscripcionRequirementGate,
  getInscripcionRequirementsConfig,
  type InscripcionRequirementGateOutcome,
  type InscripcionRequirementGateResult,
  type InscripcionRequirementOpsRow,
  type InscripcionRequirementsConfig,
} from "./requirement-gate";

export {
  INSCRIPCION_REBOOK_TASK_KIND,
  type AgendaInscripcionRequirementStatus,
  type AgendaInscripcionRequirementSourceType,
  type AgendaInscripcionRequirement,
  type AgendaInscripcionActiveBooking,
  type InscripcionRebookTaskKind,
} from "./types";

export type {
  AgendaInscripcionRepo,
  BookInscripcionParams,
  CancelInscripcionParams,
  ReagendarInscripcionParams,
  InscripcionAvailabilitySlot,
  InscripcionMutationResult,
} from "./repo";

export { AgendaInscripcionError } from "./supabase.error";
export {
  mapBookInscripcionRpcError,
  mapCancelInscripcionRpcError,
  mapMesaSolicitarInscripcionRpcError,
  INSCRIPCION_LAST_SLOT_MESSAGE,
} from "./rpc-error";
export { SupabaseAgendaInscripcionRepo } from "./supabase.repo";
export {
  formatInscripcionFixedTimeDisplay,
  isInscripcionRequirementOpen,
  isInscripcionAgendarCtaVisible,
  isInscripcionManageVisible,
  canMesaSolicitarInscripcion,
  inscripcionRequirementStatusLabel,
  formatInscripcionCupoLabel,
} from "./ui";
export {
  mapInscripcionRequirementToDashboardNotification,
  mergeInscripcionBellNotifications,
  INSCRIPCION_REBOOK_DASHBOARD_PRIORITY,
} from "./notification-map";

export function useAgendaInscripcionRepo(): AgendaInscripcionRepo | null {
  return useMemo(() => {
    if (!isDataModeSupabase()) return null;
    return new SupabaseAgendaInscripcionRepo();
  }, []);
}
