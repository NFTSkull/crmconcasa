/**
 * Helpers puros del mapeo auto-precalificar (sin I/O).
 * Usados por la route y por tests aislados.
 */
export type AutoPrecalScraperPayload = {
  califica?: boolean;
  success?: boolean;
  error?: string;
  datos?: {
    saldoSubcuenta?: string | number | null;
    montoCredito?: string | number | null;
  };
  razon?: string;
  mensaje?: string;
  /** RFC trabajador (pantalla precalificación Infonavit). */
  rfc?: string | null;
  /** N.R.P. (formulario inscripción; null si crédito activo u otro caso). */
  registroPatronal?: string | null;
  /** Empresa patronal (formulario inscripción). */
  empresa?: string | null;
  /** Mensaje Infonavit sin formulario de inscripción (p. ej. crédito activo). */
  advertenciaInscripcion?: string | null;
};

export const MOTIVO_NO_CUMPLE_CALIFICA_FALSE =
  "No calificó según consulta automática de Infonavit";

/** Fallo técnico Infonavit (no decisión crediticia). Reintentable por cron. */
export const REASON_INFONAVIT_SYSTEM_ERROR = "infonavit_system_error";

/**
 * Mensajes técnicos inequívocos del portal Infonavit (no rechazo crediticio).
 * Case-insensitive; ignora acentos/espacios extra. Conservador: no match genéricos.
 */
export function isInfonavitSystemErrorMessage(mensaje: unknown): boolean {
  if (typeof mensaje !== "string") return false;
  const n = mensaje
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return false;
  if (n.includes("ERROR EN EL SISTEMA")) return true;
  if (n.includes("INTENTE MAS TARDE")) return true;
  if (n.includes("INTENTA MAS TARDE")) return true;
  return false;
}

export type AutoPrecalDecision =
  | { kind: "aprobado"; monto: number }
  | { kind: "no_cumple"; motivo: string }
  | { kind: "pending_error"; reason: string };

export type AutoPrecalProgramaDb =
  | "mejoravit"
  | "subcuenta"
  | "compro_tu_casa";

/** Campo scraper → monto según programa DB. */
export type AutoPrecalMontoField = "saldoSubcuenta" | "montoCredito";

/**
 * Programa objetivo para el monto:
 * reprecal con cambio → `programa_solicitado`; si no, vigente.
 */
export function resolveProgramaParaMonto(args: {
  programa?: string | null;
  programaSolicitado?: string | null;
}): string | null {
  const solicitado = String(args.programaSolicitado ?? "").trim();
  if (solicitado) return solicitado;
  const vigente = String(args.programa ?? "").trim();
  return vigente || null;
}

export function montoFieldForPrograma(
  programa: string | null | undefined,
): AutoPrecalMontoField | null {
  const p = String(programa ?? "")
    .trim()
    .toLowerCase();
  if (p === "mejoravit" || p === "subcuenta") return "saldoSubcuenta";
  if (p === "compro_tu_casa") return "montoCredito";
  return null;
}

/** Parsea montos del scraper (coma miles / número). */
export function parseSaldoSubcuenta(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const parseMontoScraper = parseSaldoSubcuenta;

/**
 * Mapeo estricto: califica===true / ===false, o success:false +
 * razon=no_cumple_criterios + mensaje string; resto pending_error.
 * Errores técnicos Infonavit («ERROR EN EL SISTEMA» / «INTENTE MAS TARDE»)
 * → pending_error (nunca no_cumple), aunque califica===false.
 * Monto según programa: mejoravit/subcuenta → saldoSubcuenta;
 * compro_tu_casa → montoCredito.
 * No invoca RPC (solo decide).
 */
export function decideAutoPrecalFromScraper(
  payload: AutoPrecalScraperPayload,
  upstreamOk: boolean,
  programa: string | null | undefined,
): AutoPrecalDecision {
  // 1) Fallo HTTP / error explícito del scraper
  if (!upstreamOk || typeof payload?.error === "string") {
    return { kind: "pending_error", reason: "scraper_failed" };
  }

  // 2–3) Mensaje técnico/transitorio (gana antes de califica=false)
  if (isInfonavitSystemErrorMessage(payload.mensaje)) {
    return { kind: "pending_error", reason: REASON_INFONAVIT_SYSTEM_ERROR };
  }

  // 4) Aprobado
  if (payload.califica === true) {
    const field = montoFieldForPrograma(programa);
    if (!field) {
      return { kind: "pending_error", reason: "programa_desconocido" };
    }
    const raw =
      field === "montoCredito"
        ? payload.datos?.montoCredito
        : payload.datos?.saldoSubcuenta;
    const monto = parseMontoScraper(raw);
    if (monto == null || monto <= 0) {
      return { kind: "pending_error", reason: "invalid_saldo" };
    }
    return { kind: "aprobado", monto };
  }

  // 5) No cumple real (califica false + mensaje no técnico)
  if (payload.califica === false) {
    const motivo =
      typeof payload.mensaje === "string" && payload.mensaje.trim()
        ? payload.mensaje
        : MOTIVO_NO_CUMPLE_CALIFICA_FALSE;
    return { kind: "no_cumple", motivo };
  }

  // 6) success=false + no_cumple_criterios + mensaje real
  if (
    payload.success === false &&
    payload.razon === "no_cumple_criterios" &&
    typeof payload.mensaje === "string"
  ) {
    // Técnico ya cubierto arriba; aquí es rechazo crediticio.
    return { kind: "no_cumple", motivo: payload.mensaje };
  }

  // 7) Ambiguo
  return { kind: "pending_error", reason: "ambiguous_payload" };
}
