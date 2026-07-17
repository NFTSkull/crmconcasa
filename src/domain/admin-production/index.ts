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
export type { AdminProductionSummary, AdminMesaEnvioEvent, AdminPrecalEvent } from "./metrics";
export { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";
