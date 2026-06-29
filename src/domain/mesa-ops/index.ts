"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { MesaOpsSupabaseRepo } from "./supabase.repo";

export * from "./types";
export { MesaOpsSupabaseError } from "./supabase.error";
export { MesaOpsSupabaseRepo } from "./supabase.repo";

/** Repo ops Mesa; `null` en modo mock. */
export function useMesaOpsRepo(): MesaOpsSupabaseRepo | null {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new MesaOpsSupabaseRepo();
    }
    return null;
  }, []);
}
