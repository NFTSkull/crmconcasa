"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { useExpedientesRepo } from "@/domain/expedientes";
import { MockAdminProductionRepo } from "./mock.repo";
import { SupabaseAdminProductionRepo } from "./supabase.repo";
import type { AdminProductionRepo } from "./repo";

export function useAdminProductionRepo(): AdminProductionRepo {
  const expedientesRepo = useExpedientesRepo();
  return useMemo(() => {
    if (isDataModeSupabase()) return new SupabaseAdminProductionRepo();
    return new MockAdminProductionRepo(expedientesRepo);
  }, [expedientesRepo]);
}

export type {
  AdminProductionRepo,
  AdminProductionFilters,
  AdminAsesorProductionRow,
  AdminEstadoFilter,
  AdminPrecalDecisionFilter,
} from "./repo";
export type { AdminPeriodBounds, AdminPeriodPreset } from "./period";
export {
  resolveAdminPeriodBounds,
  ADMIN_BUSINESS_TIMEZONE,
  isMontoMayorA20000,
  ADMIN_MONTO_MAYOR_A,
} from "./period";
export type {
  AdminProductionSummary,
  AdminMesaEnvioEvent,
  AdminPrecalEvent,
} from "./metrics";
export {
  labelEditorDecision,
  decisionBadgeClass,
  isProgramaMejoravit,
  computePrecalMontosMejoravit,
  nextNoCumpleAt,
  resolvePrecalVisibleFecha,
  MONTO_SNAPSHOT_NO_RECUPERABLE_LABEL,
  formatPrecalMontoAlAprobarDisplay,
  emptyAdminMesaSeguimientoFields,
} from "./metrics";
export {
  MONTO_MAXIMO_APORTACION_MEJORAVIT_ADMIN,
  aportacionMontoAprobadoMejoravitAdmin,
} from "./monto-aportacion-admin";
export {
  labelAdminMesaAction,
  ADMIN_MESA_LAST_ACTIVITY_ACTIONS,
  ADMIN_MESA_TIMELINE_ACTIONS,
  ADMIN_MESA_TIMELINE_SUMMARY_KEYS,
  sanitizeAdminSafeText,
  sanitizeAdminMotivo,
  sanitizeAdminTimelineSummary,
  formatAdminMesaAsesorLabel,
  formatAdminMesaEsperaLabel,
} from "./mesa-seguimiento";
export type {
  AdminMesaTimelineEvent,
  AdminMesaCorreccionTipo,
} from "./mesa-seguimiento";
export { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";
