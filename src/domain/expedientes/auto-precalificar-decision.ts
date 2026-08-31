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
 * Monto según programa: mejoravit/subcuenta → saldoSubcuenta;
 * compro_tu_casa → montoCredito.
 * No invoca RPC (solo decide).
 */
export function decideAutoPrecalFromScraper(
  payload: AutoPrecalScraperPayload,
  upstreamOk: boolean,
  programa: string | null | undefined,
): AutoPrecalDecision {
  if (!upstreamOk || typeof payload?.error === "string") {
    return { kind: "pending_error", reason: "scraper_failed" };
  }
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
  if (payload.califica === false) {
    const motivo =
      typeof payload.mensaje === "string" && payload.mensaje.trim()
        ? payload.mensaje
        : MOTIVO_NO_CUMPLE_CALIFICA_FALSE;
    return { kind: "no_cumple", motivo };
  }
  if (
    payload.success === false &&
    payload.razon === "no_cumple_criterios" &&
    typeof payload.mensaje === "string"
  ) {
    return { kind: "no_cumple", motivo: payload.mensaje };
  }
  return { kind: "pending_error", reason: "ambiguous_payload" };
}
