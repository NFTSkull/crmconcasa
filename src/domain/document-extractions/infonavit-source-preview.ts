/**
 * P4A — mapeo contexto de captura Infonavit Mesa → documento fuente (preview).
 * Solo UI de referencia visual; sin extracción ni completar campos.
 */

export type InfonavitSourcePreviewContext =
  | "identidad"
  | "rfc"
  | "clabe"
  | "vivienda"
  | "none";

export type InfonavitSourceDocKind =
  | "cliente_ine_frente"
  | "cliente_ine_reverso"
  | "cliente_estado_cuenta"
  | "cliente_comprobante_domicilio";

export type InfonavitSourceFieldKey =
  | "nombres"
  | "apellidoPaterno"
  | "apellidoMaterno"
  | "curp"
  | "identificacionTipo"
  | "identificacionNumero"
  | "identificacionVigencia"
  | "rfc"
  | "clabeDerechohabiente"
  | "viviendaCalle"
  | "viviendaNoExt"
  | "viviendaNoInt"
  | "viviendaLote"
  | "viviendaManzana"
  | "viviendaColonia"
  | "viviendaCp"
  | "viviendaEntidad"
  | "viviendaMunicipio"
  | "viviendaTipoPropiedad"
  | "other";

const IDENTIDAD_FIELDS = new Set<InfonavitSourceFieldKey>([
  "nombres",
  "apellidoPaterno",
  "apellidoMaterno",
  "curp",
  "identificacionTipo",
  "identificacionNumero",
  "identificacionVigencia",
]);

const VIVIENDA_FIELDS = new Set<InfonavitSourceFieldKey>([
  "viviendaCalle",
  "viviendaNoExt",
  "viviendaNoInt",
  "viviendaLote",
  "viviendaManzana",
  "viviendaColonia",
  "viviendaCp",
  "viviendaEntidad",
  "viviendaMunicipio",
  "viviendaTipoPropiedad",
]);

export function resolveInfonavitSourcePreviewContext(
  field: InfonavitSourceFieldKey,
): InfonavitSourcePreviewContext {
  if (IDENTIDAD_FIELDS.has(field)) return "identidad";
  if (field === "rfc") return "rfc";
  if (field === "clabeDerechohabiente") return "clabe";
  if (VIVIENDA_FIELDS.has(field)) return "vivienda";
  return "none";
}

export function primaryDocKindsForContext(
  context: InfonavitSourcePreviewContext,
): readonly InfonavitSourceDocKind[] {
  switch (context) {
    case "identidad":
      return ["cliente_ine_frente", "cliente_ine_reverso"];
    case "rfc":
    case "clabe":
      return ["cliente_estado_cuenta"];
    case "vivienda":
      return ["cliente_comprobante_domicilio"];
    case "none":
    default:
      return [];
  }
}

export function friendlyDocLabel(kind: InfonavitSourceDocKind): string {
  switch (kind) {
    case "cliente_ine_frente":
      return "INE (frente)";
    case "cliente_ine_reverso":
      return "INE (reverso)";
    case "cliente_estado_cuenta":
      return "Estado de cuenta";
    case "cliente_comprobante_domicilio":
      return "Comprobante de domicilio";
  }
}

export function missingDocMessage(
  context: InfonavitSourcePreviewContext,
): string {
  switch (context) {
    case "identidad":
      return "Falta INE (frente o reverso) activo en el expediente.";
    case "rfc":
    case "clabe":
      return "Falta estado de cuenta activo en el expediente.";
    case "vivienda":
      return "Falta comprobante de domicilio activo en el expediente.";
    default:
      return "Selecciona un campo de identidad, RFC, CLABE o vivienda.";
  }
}

/**
 * Preferencia INE: Frente si existe; si no, Reverso.
 * No alterna automáticamente por campo dentro de identidad.
 */
export function pickInitialIneSide(available: {
  frente: boolean;
  reverso: boolean;
}): "frente" | "reverso" | null {
  if (available.frente) return "frente";
  if (available.reverso) return "reverso";
  return null;
}

export function ineSideToDocKind(
  side: "frente" | "reverso",
): InfonavitSourceDocKind {
  return side === "frente" ? "cliente_ine_frente" : "cliente_ine_reverso";
}

export function resolveActiveDocKind(input: {
  context: InfonavitSourcePreviewContext;
  ineSide: "frente" | "reverso" | null;
  hasFrente: boolean;
  hasReverso: boolean;
  hasEstadoCuenta: boolean;
  hasComprobante: boolean;
}): InfonavitSourceDocKind | null {
  const { context } = input;
  if (context === "identidad") {
    const side =
      input.ineSide ??
      pickInitialIneSide({
        frente: input.hasFrente,
        reverso: input.hasReverso,
      });
    if (!side) return null;
    if (side === "frente" && input.hasFrente) return "cliente_ine_frente";
    if (side === "reverso" && input.hasReverso) return "cliente_ine_reverso";
    // lado elegido no disponible → fallback al otro
    if (input.hasFrente) return "cliente_ine_frente";
    if (input.hasReverso) return "cliente_ine_reverso";
    return null;
  }
  if (context === "rfc" || context === "clabe") {
    return input.hasEstadoCuenta ? "cliente_estado_cuenta" : null;
  }
  if (context === "vivienda") {
    return input.hasComprobante ? "cliente_comprobante_domicilio" : null;
  }
  return null;
}

/** Solo filas current (deleted_at null). listByExpediente ya filtra; defensa extra. */
export function isCurrentDocumentoRow(row: {
  deleted_at?: string | null;
}): boolean {
  return row.deleted_at == null || row.deleted_at === undefined;
}
