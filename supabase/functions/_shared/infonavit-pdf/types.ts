/**
 * P189 B1 — Input canónico independiente del CRM.
 * Semántica de dominio (no nombres AcroForm). Futuro puente B3→B4.
 */

export type InfonavitDocumentType =
  | "carta_bajo_protesta"
  | "presupuesto_mejoramiento"
  | "solicitud_inscripcion_credito";

export type GeneroCodigo = "M" | "F";
export type EstadoCivilCodigo = "soltero" | "casado";
export type RegimenMatrimonialCodigo = "separacion_bienes" | "sociedad_conyugal";
export type TipoPropiedadCodigo = "propia" | "conyuge_concubino" | "familiar";

export interface InfonavitIdentificacionInput {
  tipo?: string | null;
  numero?: string | null;
  /** Texto de vigencia ya formateado para el PDF (p.ej. DD/MM/AA). */
  vigencia?: string | null;
}

export interface InfonavitClienteInput {
  /** Nombre legal completo sin separar. Preferido sobre apellidos+nombres. */
  nombreCompleto?: string | null;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nss: string;
  curp: string;
  rfc: string;
  celular?: string | null;
  telefono?: string | null;
  /** LADA local; nunca +52 por defecto. */
  ladaTelefono?: string | null;
  correo?: string | null;
  genero?: GeneroCodigo | null;
  estadoCivil?: EstadoCivilCodigo | null;
  regimenMatrimonial?: RegimenMatrimonialCodigo | null;
  identificacion?: InfonavitIdentificacionInput | null;
}

export interface InfonavitEmpresaInput {
  nombre?: string | null;
  registroPatronal?: string | null;
  lada?: string | null;
  telefono?: string | null;
  extension?: string | null;
}

export interface InfonavitViviendaInput {
  calle?: string | null;
  noExt?: string | null;
  noInt?: string | null;
  lote?: string | null;
  manzana?: string | null;
  colonia?: string | null;
  entidad?: string | null;
  municipio?: string | null;
  cp?: string | null;
  tipoPropiedad?: TipoPropiedadCodigo | null;
  /**
   * Dirección libre ya partida o a partir (presupuesto / mejora).
   * Si ausente, el renderer puede componer desde campos estructurados.
   */
  direccionLibre?: string | null;
  /** Domicilio CRM sin parsear (`expedientes.direccion_opcional`). */
  direccionCompleta?: string | null;
}

export interface InfonavitCreditoInput {
  /** Monto en pesos (number). El formatter evita float silencioso vía centavos. */
  montoSolicitado?: number | null;
  /**
   * Plazo en años (B3 snapshot). T29 imprime este número, sin ×12.
   * Preferido sobre `plazoMeses` cuando ambos existen.
   */
  plazoAnios?: number | null;
  /** Legado B1 tests. No convertir ×12. */
  plazoMeses?: number | null;
}

export interface InfonavitReferenciaInput {
  apellidoPaterno?: string | null;
  apellidoMaterno?: string | null;
  nombres?: string | null;
  lada?: string | null;
  telefono?: string | null;
  celular?: string | null;
}

export interface InfonavitBeneficiarioInput {
  parentesco?: string | null;
  apellidoPaterno?: string | null;
  apellidoMaterno?: string | null;
  nombres?: string | null;
}

export interface InfonavitMejoraInput {
  descripcion?: string | null;
  presupuestoEstimado?: number | null;
}

/**
 * Snapshot canónico. `fechaDocumento` = YYYY-MM-DD ya resuelto a
 * America/Monterrey por el productor (futuro B3). El renderer NO aplica TZ.
 */
export interface InfonavitPdfSnapshotInput {
  fechaDocumento: string;
  localidad: string;
  /** Ciudad de cierre Solicitud p.2; si ausente, se usa `localidad`. */
  ciudadCierre?: string | null;
  cliente: InfonavitClienteInput;
  empresa?: InfonavitEmpresaInput | null;
  vivienda?: InfonavitViviendaInput | null;
  credito?: InfonavitCreditoInput | null;
  referencias?: InfonavitReferenciaInput[] | null;
  beneficiario?: InfonavitBeneficiarioInput | null;
  mejora?: InfonavitMejoraInput | null;
}

export interface GenerateInfonavitPdfArgs {
  documentType: InfonavitDocumentType;
  templateBytes: Uint8Array;
  snapshot: InfonavitPdfSnapshotInput;
}
