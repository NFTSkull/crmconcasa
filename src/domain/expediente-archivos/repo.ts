import type {
  EstatusRevision,
  ExpedienteArchivoResumen,
  TipoDocumentoCatalogo,
} from "./types";

export type UploadArchivoParams = {
  expedienteId: string;
  tipo_documento: TipoDocumentoCatalogo;
  file: File;
  uploaded_by_role: string;
  uploaded_by_email: string;
};

export type ReplaceArchivoParams = UploadArchivoParams;

export type UploadMesaDocumentoParams = {
  expedienteId: string;
  tipo_documento: import("./integration-docs-completos").IntegrationDocMesaRegisterTipo;
  file: File;
};

export type ReplaceMesaDocumentoParams = UploadMesaDocumentoParams;

export type CorrectArchivoParams = {
  expedienteId: string;
  tipo_documento: import("./integration-docs-completos").IntegrationDocAsesorUploadTipo;
  file: File;
};

export type UpdateRevisionPatch = {
  estatus_revision: EstatusRevision;
  comentario_mesa?: string | null;
};

export interface ExpedienteArchivosRepo {
  listByExpediente(expedienteId: string): Promise<{
    expediente_id: string;
    tipo_documento: TipoDocumentoCatalogo;
    id: string;
    nombre_original: string;
    mime_type: string;
    size_bytes: number;
    version: number;
    created_at: string;
    uploaded_by_role: string;
    uploaded_by_email: string;
    uploaded_by_name: string | null;
    estatus_revision: EstatusRevision;
    comentario_mesa: string | null;
  }[]>;

  uploadArchivo(params: UploadArchivoParams): Promise<void>;
  replaceArchivo(params: ReplaceArchivoParams): Promise<void>;

  uploadMesaDocumento(params: UploadMesaDocumentoParams): Promise<void>;
  replaceMesaDocumento(params: ReplaceMesaDocumentoParams): Promise<void>;

  correctArchivoRechazado(params: CorrectArchivoParams): Promise<void>;

  getArchivoBlob(id: string): Promise<Blob>;

  updateRevision(id: string, patch: UpdateRevisionPatch): Promise<void>;

  deleteArchivo?(id: string): Promise<void>;

  /** Resumen por expediente: una fila por `TIPO_DOCUMENTO_CATALOGO`, orden fijo del catálogo. */
  listResumenByExpediente(expedienteId: string): Promise<ExpedienteArchivoResumen[]>;
}

