"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { ExpedienteRetencionSupabaseRepo } from "./supabase.repo";

export * from "./types";
export * from "./retencion-envio-mesa";
export * from "./asesor-retencion-panel";
export * from "./mesa-retencion-docs";
export { ExpedienteRetencionSupabaseError } from "./supabase.error";
export { mapRegisterRetencionDocRpcError } from "./register-retencion-doc-rpc-error";
export { mapEnviarRetencionMesaRpcError } from "./enviar-retencion-mesa-rpc-error";
export {
  ExpedienteRetencionSupabaseRepo,
  mapSupabaseRetencionOpcionRow,
  mapSupabaseRetencionEnvioRow,
} from "./supabase.repo";

/** Repo Supabase retención etapa 8; `null` en modo mock. */
export function useExpedienteRetencionSupabaseRepo(): ExpedienteRetencionSupabaseRepo | null {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new ExpedienteRetencionSupabaseRepo();
    }
    return null;
  }, []);
}
