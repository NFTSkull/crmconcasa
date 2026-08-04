/** Estados y tipos de validación de identidad CURP/RFC (piloto P156). */

export const CURP_LOCAL_STATUS = [
  "SIN_CURP",
  "FORMATO_INVALIDO",
  "DIGITO_INVALIDO",
  "VALIDA_LOCALMENTE",
  "FECHA_NO_COINCIDE",
  "SEXO_NO_COINCIDE",
  "ENTIDAD_NO_COINCIDE",
  "DATOS_INCOMPLETOS",
] as const;

export type CurpLocalStatus = (typeof CURP_LOCAL_STATUS)[number];

export const CONSTANCIA_STATUS = [
  "CONSTANCIA_NO_ANALIZADA",
  "CONSTANCIA_ANALIZANDO",
  "CONSTANCIA_LEGIBLE",
  "PDF_NO_LEGIBLE",
  "CURP_CERTIFICADA_REGISTRO_CIVIL",
  "CURP_NO_CERTIFICADA",
  "CERTIFICACION_OTRA_AUTORIDAD",
  "DATOS_NO_COINCIDEN",
  "ERROR_ANALISIS",
] as const;

export type ConstanciaStatus = (typeof CONSTANCIA_STATUS)[number];

export const RFC_ESTIMADO_STATUS = [
  "SIN_DATOS",
  "ESTIMACION_PENDIENTE",
  "RFC_ESTIMADO",
  "RFC_ESTIMADO_APLICADO",
  "RFC_CAPTURADO_COINCIDE",
  "RFC_CAPTURADO_NO_COINCIDE",
  "RFC_VALIDACION_SAT_PENDIENTE",
  "RFC_OFICIAL_CONFIRMADO",
] as const;

export type RfcEstimadoStatus = (typeof RFC_ESTIMADO_STATUS)[number];

export const VALIDACION_IDENTIDAD_TIPOS = [
  "curp_local",
  "curp_constancia",
  "curp_certificacion_registro_civil",
  "curp_coincidencia_datos",
  "rfc_estimado",
  "rfc_validacion_sat",
] as const;

export type ValidacionIdentidadTipo = (typeof VALIDACION_IDENTIDAD_TIPOS)[number];

export const VALIDACION_IDENTIDAD_METODOS = [
  "local",
  "pdf_constancia",
  "manual_asistido",
  "api_oficial",
] as const;

export type ValidacionIdentidadMetodo =
  (typeof VALIDACION_IDENTIDAD_METODOS)[number];

export const CLIENTE_CONSTANCIA_CURP_TIPO = "cliente_constancia_curp" as const;

export const CLIENTE_CONSTANCIA_CURP_CONTRACT = Object.freeze({
  tipo: CLIENTE_CONSTANCIA_CURP_TIPO,
  label: "Constancia CURP",
  origen: "Asesor" as const,
  formatos: ["PDF"] as const,
  mimePermitidos: ["application/pdf"] as const,
  maxBytes: 15 * 1024 * 1024,
  obligatorio: false,
  esGateAvance: false,
});

/** Feature flag FE/piloto: no bloquea envío a Mesa. */
export const CURP_VALIDACION_PILOTO_ENABLED =
  process.env.NEXT_PUBLIC_CURP_VALIDACION_PILOTO !== "false";

export type CurpDerivedIdentity = Readonly<{
  fechaNacimiento: string | null; // YYYY-MM-DD
  sexo: "H" | "M" | "X" | null;
  entidadNacimiento: string | null; // código 2 letras
}>;

export type ConstanciaExtractedIdentity = Readonly<{
  curp: string | null;
  nombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  nombreCompleto: string | null;
  sexo: string | null;
  fechaNacimiento: string | null;
  nacionalidad: string | null;
  entidadNacimiento: string | null;
  documentoProbatorio: string | null;
  anioRegistro: string | null;
  numeroActa: string | null;
  entidadRegistro: string | null;
  municipioRegistro: string | null;
  certificadaRegistroCivil: boolean;
  certificacionOtraAutoridad: boolean;
}>;

export type CampoComparacion = Readonly<{
  campo: string;
  capturado: string | null;
  constancia: string | null;
  resultado: "coincide" | "no_coincide" | "no_disponible";
  mensaje?: string;
}>;
