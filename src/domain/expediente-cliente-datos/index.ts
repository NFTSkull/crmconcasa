"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { MockExpedienteClienteDatosLocalStorageRepo } from "./mock-localstorage.repo";
import { SupabaseExpedienteClienteDatosRepo } from "./supabase.repo";
import type { ExpedienteClienteDatosRepo } from "./repo";

export type { ExpedienteClienteDatosRepo } from "./repo";
export type {
  ExpedienteClienteDatos,
  ExpedienteClienteDatosEstado,
  ClienteDatosImagen,
  SaveExpedienteClienteDatosInput,
  UpdateEstadoExpedienteClienteDatosInput,
} from "./types";
export { MockExpedienteClienteDatosLocalStorageRepo } from "./mock-localstorage.repo";
export { SupabaseExpedienteClienteDatosRepo } from "./supabase.repo";
export { ClienteDatosSupabaseError } from "./supabase.error";
export { mapSaveClienteDatosRpcError } from "./save-cliente-datos-rpc-error";
export { mapSaveClienteDatosCorreccionRpcError } from "./save-cliente-datos-correccion-rpc-error";
export { mapUpdateClienteDatosRevisionRpcError } from "./update-cliente-datos-revision-rpc-error";
export {
  MESA_CLIENTE_DATOS_RECHAZO_MOTIVOS,
  buildComentarioRechazoClienteDatos,
  isClienteDatosMotivoOtro,
  type MesaClienteDatosRechazoMotivo,
} from "./mesa-cliente-datos-rechazo-motivos";
export {
  buildSaveClienteDatosRpcPayload,
  mapSupabaseRowToExpedienteClienteDatos,
} from "./map-supabase-cliente-datos";

/** Factory: mock localStorage por defecto; Supabase con `NEXT_PUBLIC_DATA_MODE=supabase`. */
export function useExpedienteClienteDatosRepo(): ExpedienteClienteDatosRepo {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseExpedienteClienteDatosRepo();
    }
    return new MockExpedienteClienteDatosLocalStorageRepo();
  }, []);
}
