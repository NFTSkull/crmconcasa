"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { AsesorLiderMockRepo } from "./mock.repo";
import { AsesorLiderSupabaseRepo } from "./supabase.repo";

export type { AsesorLiderCapability } from "./types";
export type {
  AsesorActivoOrg,
  AsesorLiderContext,
  AsesorLiderDashboard,
  AsesorLiderDashboardFilters,
  AsesorLiderEtapaBucket,
  AsesorLiderExpedienteRow,
  AsesorLiderExpedientesPage,
  AsesorLiderMember,
  AsesorLiderTeam,
  CreateExpedienteForAsesorInput,
} from "./types";

export {
  ASESOR_LIDER_DEFAULT_PAGE_SIZE,
  ASESOR_LIDER_MAX_PAGE_SIZE,
  CAP_CREATE_FOR_ANY_ADVISOR,
  CAP_INTEGRATE_FOR_ANY_ADVISOR,
  CAP_TEAM_DASHBOARD_READ,
  asesorLiderContextSchema,
  asesorLiderDashboardSchema,
  asesorLiderExpedientesPageSchema,
  asesorLiderListPageInputSchema,
  asesorLiderMembersResultSchema,
  asesorLiderTotalPages,
  clampAsesorLiderPage,
  hasCapability,
  isAsesorLiderDashboardMode,
  listAsesoresActivosOrgResultSchema,
  normalizeAsesorLiderPageOptions,
} from "./rpc";

export { AsesorLiderSupabaseError, AsesorLiderSupabaseRepo } from "./supabase.repo";
export { AsesorLiderMockRepo } from "./mock.repo";

export type AsesorLiderRepo = AsesorLiderSupabaseRepo | AsesorLiderMockRepo;

export function useAsesorLiderRepo(): AsesorLiderRepo {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new AsesorLiderSupabaseRepo();
    }
    return new AsesorLiderMockRepo({ leaderMode: false });
  }, []);
}
