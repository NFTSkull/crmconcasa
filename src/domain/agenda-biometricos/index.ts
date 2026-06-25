"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { SupabaseAgendaBiometricosConfigRepo } from "./supabase.repo";
import { SupabaseAgendaBiometricosBookingRepo } from "./supabase-booking.repo";
import type { AgendaBiometricosBookingRepo, AgendaBiometricosConfigRepo } from "./repo";

export * from "./types";
export * from "./availability";
export * from "./booking-mutations";
export * from "./mock-localstorage.repo";
export * from "./map-agenda-config";
export * from "./weekly-availability";
export * from "./repo";
export { AgendaBiometricosSupabaseError } from "./supabase.error";
export { mapUpsertAgendaConfigBiometricosRpcError } from "./upsert-agenda-config-rpc-error";
export { mapBookBiometricosRpcError } from "./book-biometricos-rpc-error";
export { SupabaseAgendaBiometricosConfigRepo } from "./supabase.repo";
export { SupabaseAgendaBiometricosBookingRepo } from "./supabase-booking.repo";

/** Solo `mesa_admin` (UI: mesa_control_admin) y `super_admin` pueden editar config biométrica. */
export function canEditAgendaBiometricosWeeklyConfig(mockRole: string): boolean {
  return mockRole === "mesa_control_admin" || mockRole === "super_admin";
}

/** Repo Supabase de config biométrica; `null` en modo mock. */
export function useAgendaBiometricosConfigRepo(): AgendaBiometricosConfigRepo | null {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseAgendaBiometricosConfigRepo();
    }
    return null;
  }, []);
}

/** Repo Supabase de reservas biométricas; `null` en modo mock. */
export function useAgendaBiometricosBookingRepo(): AgendaBiometricosBookingRepo | null {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseAgendaBiometricosBookingRepo();
    }
    return null;
  }, []);
}
