/**
 * P2 shadow — contrato de extracciones documentales (SIN OCR / SIN provider).
 * Allowlist explícita de 4 tipos. Fixtures sintéticos solamente.
 */

export const DOCUMENT_EXTRACTION_TIPOS_PERMITIDOS = [
  "cliente_ine_frente",
  "cliente_ine_reverso",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
] as const;

export type DocumentExtractionTipoPermitido =
  (typeof DOCUMENT_EXTRACTION_TIPOS_PERMITIDOS)[number];

export const DOCUMENT_EXTRACTION_STATUSES = [
  "pending",
  "processing",
  "done",
  "failed",
  "stale",
  "skipped",
] as const;

export type DocumentExtractionStatus =
  (typeof DOCUMENT_EXTRACTION_STATUSES)[number];

export const DOCUMENT_EXTRACTION_JOB_STATUSES = [
  "pending",
  "processing",
  "done",
  "failed",
  "dead",
  "cancelled",
  "stale",
] as const;

export type DocumentExtractionJobStatus =
  (typeof DOCUMENT_EXTRACTION_JOB_STATUSES)[number];

/** Vault: fail-closed DEFAULT OFF. No reutilizar flags P189. */
export const DOCUMENT_EXTRACTION_VAULT_ENQUEUE_ENABLED =
  "document_extraction_enqueue_enabled" as const;
export const DOCUMENT_EXTRACTION_VAULT_ACTIVATION_AT =
  "document_extraction_activation_at" as const;

export const DOCUMENT_EXTRACTION_DEFAULT_PROVIDER = "shadow" as const;
export const DOCUMENT_EXTRACTION_DEFAULT_PROVIDER_VERSION = "p2" as const;

/**
 * Provenance de un campo normalizado.
 * T7 (número identificación) puede aparecer como candidato; sin regla de autofill.
 */
export type DocumentExtractionFieldProvenance = Readonly<{
  value: string | null;
  normalizedValue?: string | null;
  confidence: number;
  sourceDocumentType: DocumentExtractionTipoPermitido;
  sourceDocumentId: string;
  documentVersion: number;
  page?: number | null;
  bbox?: Readonly<[number, number, number, number]> | null;
  extractionRule?: string | null;
}>;

export type DocumentExtractionPayloadNormalized = Readonly<{
  fields: Readonly<Record<string, DocumentExtractionFieldProvenance>>;
}>;

/** Fuentes de verdad futuras (documentación; no implementadas en P2). */
export const DOCUMENT_EXTRACTION_FUENTES_VERDAD = {
  identidad: ["cliente_ine_frente", "cliente_ine_reverso"] as const,
  vivienda: ["cliente_comprobante_domicilio"] as const,
  clabe: ["cliente_estado_cuenta"] as const,
} as const;

/** Campos candidatos INE (sin autofill; T7 bloqueado para decisión). */
export const DOCUMENT_EXTRACTION_INE_FIELD_CANDIDATES = [
  "titular.nombres",
  "titular.apellidoPaterno",
  "titular.apellidoMaterno",
  "titular.curp",
  "identificacion.tipo",
  "identificacion.numero", // T7 BLOQUEADO — sin regla de autofill
  "identificacion.vigencia",
] as const;

export const DOCUMENT_EXTRACTION_CFE_FIELD_CANDIDATES = [
  "vivienda.direccionTexto",
] as const;

export const DOCUMENT_EXTRACTION_ESTADO_CUENTA_FIELD_CANDIDATES = [
  "pago.clabeCandidatos",
] as const;

export function isDocumentExtractionTipoPermitido(
  tipo: string | null | undefined,
): tipo is DocumentExtractionTipoPermitido {
  if (!tipo) return false;
  return (DOCUMENT_EXTRACTION_TIPOS_PERMITIDOS as readonly string[]).includes(
    tipo,
  );
}

/**
 * Fixture sintético — sin PII real.
 * Usar solo en tests/docs.
 */
export function fixturePayloadNormalizedShadow(input: {
  sourceDocumentType: DocumentExtractionTipoPermitido;
  sourceDocumentId: string;
  documentVersion: number;
}): DocumentExtractionPayloadNormalized {
  return {
    fields: {
      "titular.nombres": {
        value: "NOMBRE_SINTETICO",
        normalizedValue: "NOMBRE_SINTETICO",
        confidence: 0.99,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        documentVersion: input.documentVersion,
        page: 1,
        bbox: [0.1, 0.2, 0.3, 0.4],
        extractionRule: "shadow_fixture_p2",
      },
    },
  };
}
