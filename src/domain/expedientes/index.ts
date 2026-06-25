"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { MockExpedientesRepo } from "./mock.repo";
import { SupabaseExpedientesRepo } from "./supabase.repo";
import type { ExpedientesRepo } from "./repo";

export type { ExpedientesRepo } from "./repo";
export type { CreateExpedienteInput } from "./create-expediente.input";
export type { UpsertEditorDecisionInput } from "./upsert-editor-decision.input";
export type { ExpedienteMock, EditorDecision } from "./mock.repo";
export { MockExpedientesRepo } from "./mock.repo";
export { SupabaseExpedientesRepo, ExpedientesSupabaseError } from "./supabase.repo";
export { mapEnviarAMesaRpcError } from "./enviar-mesa-rpc-error";
export { mapAvanzarEtapaRpcError } from "./avanzar-etapa-rpc-error";
export { mapUpsertEditorDecisionRpcError } from "./upsert-editor-decision-rpc-error";
export {
  deriveBloqueosContinuarIntegracion,
  puedeContinuarIntegracion,
  puedeMostrarContinuarIntegracion,
  type MesaContinuarIntegracionContext,
} from "./mesa-avance-integracion";
export {
  mapProgramaDbToUi,
  mapProgramaUiToDb,
} from "./map-programa";
export {
  mapCreateExpedienteRpcToExpedienteMock,
  mapSupabaseRowToExpedienteMock,
} from "./map-supabase-row";

/** Factory: mock por defecto; Supabase con `NEXT_PUBLIC_DATA_MODE=supabase`. */
export function useExpedientesRepo(): ExpedientesRepo {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseExpedientesRepo();
    }
    return new MockExpedientesRepo();
  }, []);
}
