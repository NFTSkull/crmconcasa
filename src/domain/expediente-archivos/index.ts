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
  type ExpedienteArchivoListItem,
  type SupabaseExpedienteDocumentoRow,
} from "./map-supabase-expediente-documentos";
export {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_OBLIGATORIOS,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  countIntegrationDocsPresentes,
  countIntegrationDocsValidados,
  deriveIntegrationDocsChecklist,
  deriveIntegrationDocsChecklistOpcionales,
  estatusCuentaParaIntegracion,
  estatusCuentaComoValidadoMesa,
  integrationDocsCompletos,
  integrationDocsTodosValidados,
  integrationDocsResumenFromArchivoResumen,
  type IntegrationDocAsesorEnvioTipo,
  type IntegrationDocAsesorOpcionalTipo,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocChecklistItem,
  type IntegrationDocMesaUploadTipo,
  type IntegrationDocTipo,
} from "./integration-docs-completos";
export { mesaPuedeAbrirArchivo } from "./mesa-archivo-acceso";
export {
  MESA_RECHAZO_MOTIVOS_SUGERIDOS,
  buildComentarioRechazoDocumento,
  isMotivoOtro,
  type MesaRechazoMotivoSugerido,
} from "./mesa-rechazo-motivos";
export { mapUpdateDocumentoRevisionRpcError } from "./update-documento-revision-rpc-error";
export {
  buildMesaIntegrationDocViews,
  resolveMesaArchivoPorTipo,
  type MesaIntegrationDocView,
} from "./mesa-integration-docs";
export {
  buildMesaComplementariosDocViews,
  semanasCotizadasEsOpcionalMesa,
  type MesaComplementarioDocView,
  type MesaComplementarioEtiqueta,
} from "./mesa-complementarios-docs";
export {
  asesorDebeUsarCorreccionDocumento,
  asesorDebeUsarCorreccionClienteDatos,
  asesorDocumentoUploadMode,
  asesorPuedeCorregirDocumentoRechazado,
  asesorPuedeEditarClienteDatos,
  asesorPuedeSubirDocumentoPreMesa,
  asesorPuedeSubirOCorregirDocumento,
} from "./asesor-correccion-post-mesa";
export { mapRegisterExpedienteDocumentoCorreccionRpcError } from "./register-expediente-documento-correccion-rpc-error";
export { mapRegisterMesaDocumentoRpcError } from "./register-mesa-documento-rpc-error";
export {
  EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR,
  EXPEDIENTE_DOCUMENTO_MAX_MB,
  validateExpedienteDocumentoFile,
} from "./upload-constraints";
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
