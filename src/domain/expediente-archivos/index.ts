"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { MockExpedienteArchivosIndexedDbRepo } from "./mock-indexeddb.repo";
import { SupabaseExpedienteArchivosRepo } from "./supabase.repo";
import type { ExpedienteArchivosRepo } from "./repo";

export type { ExpedienteArchivosRepo } from "./repo";
export { MockExpedienteArchivosIndexedDbRepo } from "./mock-indexeddb.repo";
export { SupabaseExpedienteArchivosRepo } from "./supabase.repo";
export { ExpedienteArchivosSupabaseError } from "./supabase.error";
export {
  mapSupabaseRowToExpedienteArchivoListItem,
  type SupabaseExpedienteDocumentoRow,
} from "./map-supabase-expediente-documentos";
export {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_OBLIGATORIOS,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  estatusCuentaParaIntegracion,
  integrationDocsCompletos,
  integrationDocsResumenFromArchivoResumen,
  type IntegrationDocAsesorEnvioTipo,
  type IntegrationDocChecklistItem,
  type IntegrationDocTipo,
} from "./integration-docs-completos";
export * from "./types";
export * from "./repo";
export * from "./checklist";
export * from "./retencion-acuse-aviso";

/** Factory: IndexedDB mock por defecto; Supabase con `NEXT_PUBLIC_DATA_MODE=supabase`. */
export function useExpedienteArchivosRepo(): ExpedienteArchivosRepo {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseExpedienteArchivosRepo();
    }
    return new MockExpedienteArchivosIndexedDbRepo();
  }, []);
}
