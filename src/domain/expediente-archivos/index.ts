"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { MockExpedienteArchivosIndexedDbRepo } from "./mock-indexeddb.repo";
import { SupabaseExpedienteArchivosRepo } from "./supabase.repo";
import type { ExpedienteArchivosRepo } from "./repo";
import { withExpedienteArchivoMutationEvents } from "./mutation-events";

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
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_REGISTER,
  CLIENTE_PAGARE_DOCUMENT_TIPO,
  CLIENTE_PAGARE_DOCUMENT_CONTRACT,
  CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
  CLIENTE_NOTIFICACION_DOCUMENT_CONTRACT,
  CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
  CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT,
  CLIENTE_SOLICITUD_DOCUMENT_TIPO,
  CLIENTE_SOLICITUD_DOCUMENT_CONTRACT,
  ASESOR_EVIDENCIA_DOCUMENT_TIPO,
  ASESOR_EVIDENCIA_DOCUMENT_CONTRACT,
  CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
  CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT,
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT,
  EQUIPO_LIDER_EMAIL_SILVIA_REYES,
  CLIENTE_SOLICITUD_CREDITO_DOCUMENT_TIPO,
  CLIENTE_SOLICITUD_CREDITO_DOCUMENT_CONTRACT,
  CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
  CLIENTE_LISTA_NOMINAL_DOCUMENT_CONTRACT,
  CLIENTE_BAJO_PROTESTA_DOCUMENT_TIPO,
  CLIENTE_BAJO_PROTESTA_DOCUMENT_CONTRACT,
  CLIENTE_PRESUPUESTO_DOCUMENT_TIPO,
  CLIENTE_PRESUPUESTO_DOCUMENT_CONTRACT,
  INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO,
  type IntegrationDocAsesorScopedPorEquipoTipo,
  INTEGRATION_DOC_TIPOS_OBLIGATORIOS,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  countIntegrationDocsPresentes,
  countIntegrationDocsValidados,
  deriveIntegrationDocsChecklist,
  deriveIntegrationDocsChecklistOpcionales,
  deriveIntegrationDocsChecklistOpcionalesSoloAsesor,
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
  type IntegrationDocMesaRegisterTipo,
  type IntegrationDocTipo,
  isIntegrationDocAsesorOpcionalTipo,
} from "./integration-docs-completos";
export {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
  fetchAsesorDocumentosObligatoriosEnvio,
  parseAsesorDocumentosObligatoriosEnvio,
  type IntegrationDocAsesorEnvioExternoTipo,
  type IntegrationDocAsesorEnvioObligatorioTipo,
} from "./asesor-documentos-obligatorios-envio";
export {
  CLIENTE_PAGARE_ACCEPT_ATTR,
  buildClientePagareStoragePath,
  canMesaOperatePagare,
  findClientePagareFromList,
  formatBytesLabel,
  formatPagareMimeLabel,
  mesaPagareWriteEnabled,
  resolveClientePagareUploadMime,
  resolveMesaPagareUiMode,
  shouldShowAsesorPagareSection,
  validateClientePagareFile,
  type ClientePagareDocumento,
  type ClientePagareMime,
  type MesaPagareUiMode,
} from "./cliente-pagare";
export {
  CLIENTE_NOTIFICACION_ACCEPT_ATTR,
  buildClienteNotificacionStoragePath,
  canMesaOperateNotificacionDocumento,
  findClienteNotificacionFromList,
  formatNotificacionDocumentoMimeLabel,
  mesaNotificacionDocumentoWriteEnabled,
  resolveClienteNotificacionUploadMime,
  resolveMesaNotificacionDocumentoUiMode,
  shouldShowAsesorNotificacionDocumentoSection,
  validateClienteNotificacionFile,
  type ClienteNotificacionDocumento,
  type ClienteNotificacionMime,
  type MesaNotificacionDocumentoUiMode,
} from "./cliente-notificacion";
export {
  CLIENTE_SOLICITUD_ACCEPT_ATTR,
  buildClienteSolicitudStoragePath,
  canMesaOperateSolicitudDocumento,
  findClienteSolicitudFromList,
  formatSolicitudDocumentoMimeLabel,
  mesaSolicitudDocumentoWriteEnabled,
  resolveClienteSolicitudUploadMime,
  resolveMesaSolicitudDocumentoUiMode,
  shouldShowAsesorSolicitudDocumentoSection,
  validateClienteSolicitudFile,
  type ClienteSolicitudDocumento,
  type ClienteSolicitudMime,
  type MesaSolicitudDocumentoUiMode,
} from "./cliente-solicitud";
export {
  ASESOR_EVIDENCIA_ACCEPT_ATTR,
  ASESOR_EVIDENCIA_UPLOAD_HINT,
  ASESOR_EVIDENCIA_MIME_PERMITIDOS,
  buildAsesorEvidenciaStoragePath,
  findAsesorEvidenciaFromList,
  isAsesorEvidenciaPreviewableMime,
  isAsesorEvidenciaTipo,
  resolveAsesorEvidenciaUploadMime,
  sanitizeEvidenciaDisplayName,
  validateAsesorEvidenciaFile,
  shouldMountAsesorEvidenciaSection,
  asesorPuedeEditarEvidencia,
  type AsesorEvidenciaDocumento,
} from "./asesor-evidencia";
export {
  CLIENTE_VIGENCIA_DERECHOS_ACCEPT_ATTR,
  CLIENTE_VIGENCIA_DERECHOS_UPLOAD_HINT,
  CLIENTE_VIGENCIA_DERECHOS_MIME_PERMITIDOS,
  buildClienteVigenciaDerechosStoragePath,
  findClienteVigenciaDerechosFromList,
  isClienteVigenciaDerechosPreviewableMime,
  isClienteVigenciaDerechosTipo,
  resolveClienteVigenciaDerechosUploadMime,
  sanitizeVigenciaDerechosDisplayName,
  validateClienteVigenciaDerechosFile,
  shouldMountAsesorVigenciaDerechosSection,
  asesorPuedeEditarVigenciaDerechos,
  type ClienteVigenciaDerechosDocumento,
} from "./cliente-vigencia-derechos";
export {
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_ACCEPT_ATTR,
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_UPLOAD_HINT,
  buildClienteConstanciaSituacionFiscalStoragePath,
  findClienteConstanciaSituacionFiscalFromList,
  isClienteConstanciaSituacionFiscalPreviewableMime,
  isClienteConstanciaSituacionFiscalTipo,
  sanitizeConstanciaSituacionFiscalDisplayName,
  validateClienteConstanciaSituacionFiscalFile,
  shouldMountAsesorConstanciaSituacionFiscalSection,
  asesorPuedeEditarConstanciaSituacionFiscal,
  type ClienteConstanciaSituacionFiscalDocumento,
} from "./cliente-constancia-situacion-fiscal";
export {
  fetchAsesorTiposDocumentoVisibles,
  parseAsesorTiposDocumentoVisibles,
  shouldMountAsesorScopedEquipoDocumentoSection,
} from "./asesor-tipos-documento-visibles";
export {
  SCOPED_EQUIPO_DOCUMENTO_UI,
  SCOPED_EQUIPO_PDF_ACCEPT_ATTR,
  resolveScopedEquipoUploadHint,
  asesorPuedeEditarScopedEquipoDocumento,
  findScopedEquipoDocumentoFromList,
  formatBytesLabel as formatScopedEquipoBytesLabel,
  getScopedEquipoDocumentoUi,
  isScopedEquipoPreviewableMime,
  sanitizeScopedEquipoDisplayName,
  validateScopedEquipoPdfFile,
  type ScopedEquipoDocumento,
  type ScopedEquipoDocumentoUi,
} from "./cliente-scoped-equipo-documento";
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
  complementariosMesaSonOpcionales,
  labelPresenciaComplementario,
  semanasCotizadasEsOpcionalMesa,
  type MesaComplementarioDocView,
  type MesaComplementarioPresencia,
} from "./mesa-complementarios-docs";
export {
  asesorDebeUsarCorreccionDocumento,
  asesorDebeUsarCorreccionClienteDatos,
  asesorEsCorreccionRechazoClienteDatos,
  asesorDocumentoUploadMode,
  asesorPuedeActualizarDocReingreso,
  asesorPuedeCorregirDocumentoRechazado,
  asesorPuedeEditarClienteDatos,
  asesorPuedeMostrarUploadDocumento,
  asesorPuedeSubirDocumentoPreMesa,
  asesorPuedeSubirDocumentoNuevoReingreso,
  asesorPuedeSubirOCorregirDocumento,
  asesorPuedeSubirOpcionalFaltantePostMesa,
  asesorPuedeReemplazarDocumentoExistentePostMesa,
  esReingresoDatosEditables,
  esReingresoDocumentosEditables,
  isReingresoDocActualizableTipo,
  REINGRESO_DOC_TIPOS_ACTUALIZABLES,
} from "./asesor-correccion-post-mesa";
export { mapRegisterExpedienteDocumentoCorreccionRpcError } from "./register-expediente-documento-correccion-rpc-error";
export { mapRegisterMesaDocumentoRpcError } from "./register-mesa-documento-rpc-error";
export {
  INFONAVIT_AUTO_DOCUMENT_TYPES,
  INFONAVIT_AUTO_DOCUMENT_LABELS,
  INFONAVIT_AUTO_DOCUMENT_FILENAMES,
  isInfonavitAutoGeneratedDocumentType,
  infonavitAutoDocumentLabel,
  infonavitAutoDocumentFilename,
  type InfonavitAutoDocumentType,
} from "./infonavit-auto-document-types";
export {
  INFONAVIT_PDF_ESTADO_POLL_MS,
  infonavitPdfUiStatusLabel,
  infonavitPdfEstadoNeedsPoll,
  shouldShowInfonavitPdfSection,
  parseInfonavitPdfEstado,
  infonavitPdfEstadoJsonHasForbiddenKeys,
  displayNameForInfonavitPdfDoc,
  startInfonavitPdfEstadoPolling,
  type InfonavitPdfEstado,
  type InfonavitPdfDocumentEstado,
  type InfonavitPdfDocumentoMeta,
  type InfonavitPdfOutboxUiStatus,
} from "./infonavit-pdf-estado";
export { fetchExpedienteInfonavitPdfEstado } from "./infonavit-pdf-estado.repo";
export {
  EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR,
  EXPEDIENTE_DOCUMENTO_MAX_MB,
  validateExpedienteDocumentoFile,
} from "./upload-constraints";
export {
  ASESOR_MESA_DOCUMENTOS_COMPARTIBLES,
  buildAsesorMesaDocumentosViews,
  labelAsesorMesaDocumento,
  shouldShowAsesorMesaDocumentosSection,
  type AsesorMesaDocumentoCompartibleTipo,
  type AsesorMesaDocumentoView,
} from "./asesor-mesa-documentos";
export {
  filterChecklistOpcionalesNotificacionApodaca,
  hasNotificacionApodacaArchivoActivo,
  resolveExpedienteSedeFromLocationId,
  shouldShowNotificacionApodacaHistorico,
  shouldShowNotificacionApodacaUpload,
} from "./notificacion-apodaca-visibility";
export {
  deriveResumenExpedienteCorreccion,
  hasPendingAsesorChanges,
} from "./derive-resumen-expediente-correccion";
export * from "./types";
export * from "./repo";
export * from "./checklist";
export * from "./retencion-acuse-aviso";

/** Factory: IndexedDB mock por defecto; Supabase con `NEXT_PUBLIC_DATA_MODE=supabase`. */
export function useExpedienteArchivosRepo(): ExpedienteArchivosRepo {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return withExpedienteArchivoMutationEvents(
        new SupabaseExpedienteArchivosRepo(),
      );
    }
    return new MockExpedienteArchivosIndexedDbRepo();
  }, []);
}
