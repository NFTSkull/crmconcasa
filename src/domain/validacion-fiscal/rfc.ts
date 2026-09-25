import { validateCurpLocal } from "../identidad-curp/curp-local";

export type RfcShape = "full13" | "base10" | "invalid" | "missing";

export type RfcSourceRelation =
  | "exact"
  | "base_match_missing_homoclave"
  | "different"
  | "invalid"
  | "missing";

export type EstadoCuentaRfcCandidate = Readonly<{
  rfc: string;
  score: number;
  context: string;
  reasons: readonly string[];
}>;

export type EstadoCuentaRfcSelection = Readonly<{
  status: "selected" | "unknown";
  rfc: string | null;
  confidence: "high" | "medium" | "none";
  reason:
    | "exact_expected_match"
    | "base_expected_match"
    | "curp_base_match"
    | "curp_base_conflict"
    | "insufficient_corroboration"
    | "single_contextual_candidate"
    | "unique_high_score_candidate"
    | "no_full_rfc"
    | "ambiguous_candidates";
  candidates: readonly EstadoCuentaRfcCandidate[];
}>;

export type FiscalRfcResolution = Readonly<{
  status: "ready_for_sat" | "unknown";
  fiscalRfc: string | null;
  source: "estado_cuenta" | null;
  infonavitRelation: RfcSourceRelation;
  datosGeneralesRelation: RfcSourceRelation;
  shouldUpdateDatosGeneralesAfterSatPass: boolean;
  reason: "estado_cuenta_selected" | "estado_cuenta_unknown";
}>;

const RFC_FULL13_RE = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/u;
const RFC_BASE10_RE = /^[A-ZÑ&]{4}\d{6}$/u;
const FULL_RFC_IN_TEXT_RE = /(^|[^A-Z0-9Ñ&])([A-ZÑ&]{4}\d{6}[A-Z0-9]{3})(?![A-Z0-9Ñ&])/gu;

function foldText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function normalizeRfc(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ&]/gu, "");
}

export function curpRfcBase10(value: string | null | undefined): string | null {
  const validation = validateCurpLocal({ curp: String(value ?? "") });
  if (validation.status !== "VALIDA_LOCALMENTE") return null;
  const base = validation.normalized.slice(0, 10);
  return RFC_BASE10_RE.test(base) ? base : null;
}

export function rfcShape(value: string | null | undefined): RfcShape {
  const rfc = normalizeRfc(value);
  if (!rfc) return "missing";
  if (RFC_FULL13_RE.test(rfc)) return "full13";
  if (RFC_BASE10_RE.test(rfc)) return "base10";
  return "invalid";
}

export function rfcBase10(value: string | null | undefined): string | null {
  const rfc = normalizeRfc(value);
  const shape = rfcShape(rfc);
  if (shape === "full13" || shape === "base10") return rfc.slice(0, 10);
  return null;
}

export function relateRfc(
  source: string | null | undefined,
  fiscalRfc: string,
): RfcSourceRelation {
  const normalized = normalizeRfc(source);
  const shape = rfcShape(normalized);
  if (shape === "missing") return "missing";
  if (shape === "invalid") return "invalid";
  if (shape === "full13") return normalized === fiscalRfc ? "exact" : "different";
  return normalized === fiscalRfc.slice(0, 10)
    ? "base_match_missing_homoclave"
    : "different";
}

function nameTokens(clienteNombre: string | null | undefined): string[] {
  return foldText(clienteNombre ?? "")
    .replace(/[^A-Z0-9Ñ& ]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 4)
    .slice(0, 6);
}

function isBankRfcLabelImmediatelyBefore(value: string): boolean {
  const left = foldText(value).replace(/\s+/g, " ").slice(-72);
  return /(?:RFC\s+(?:DEL\s+)?(?:BANCO|EMISOR|INSTITUCION)|(?:BANCO|EMISOR|INSTITUCION)\s+(?:RFC|R\.?F\.?C\.?))\s*[:#-]?\s*$/.test(
    left,
  );
}

function scoreCandidate(args: {
  rfc: string;
  context: string;
  immediateBefore: string;
  rfcInfonavit?: string | null;
  rfcDatosGenerales?: string | null;
  curpValidadaLocalmente?: string | null;
  clienteNombre?: string | null;
}): EstadoCuentaRfcCandidate {
  const folded = foldText(args.context);
  const reasons: string[] = [];
  let score = 0;

  if (/\bR\.?F\.?C\.?\b|RFC\s*[:#-]?/i.test(folded)) {
    score += 4;
    reasons.push("near_rfc_label");
  }
  if (/\b(TITULAR|CLIENTE|CUENTAHABIENTE|NOMBRE)\b/.test(folded)) {
    score += 2;
    reasons.push("near_holder_label");
  }
  if (isBankRfcLabelImmediatelyBefore(args.immediateBefore)) {
    score -= 8;
    reasons.push("bank_rfc_context");
  }

  const tokens = nameTokens(args.clienteNombre);
  const matches = tokens.filter((t) => folded.includes(t)).length;
  if (matches >= 2) {
    score += 3;
    reasons.push("near_client_name");
  } else if (matches === 1) {
    score += 1;
    reasons.push("near_client_name_partial");
  }

  const inf = normalizeRfc(args.rfcInfonavit);
  const dg = normalizeRfc(args.rfcDatosGenerales);
  const curpBase = curpRfcBase10(args.curpValidadaLocalmente);
  if (rfcShape(inf) === "full13" && args.rfc === inf) {
    score += 12;
    reasons.push("exact_infonavit_match");
  } else if (rfcBase10(inf) && args.rfc.slice(0, 10) === rfcBase10(inf)) {
    score += 9;
    reasons.push("base_infonavit_match");
  }
  if (rfcShape(dg) === "full13" && args.rfc === dg) {
    score += 7;
    reasons.push("exact_dg_match");
  } else if (rfcBase10(dg) && args.rfc.slice(0, 10) === rfcBase10(dg)) {
    score += 5;
    reasons.push("base_dg_match");
  }
  if (curpBase && args.rfc.slice(0, 10) === curpBase) {
    score += 10;
    reasons.push("base_curp_match");
  }

  return { rfc: args.rfc, score, context: args.context, reasons };
}

export function extractEstadoCuentaRfcCandidates(args: {
  text: string;
  rfcInfonavit?: string | null;
  rfcDatosGenerales?: string | null;
  curpValidadaLocalmente?: string | null;
  clienteNombre?: string | null;
}): EstadoCuentaRfcCandidate[] {
  const upper = String(args.text ?? "").toUpperCase();
  const dedup = new Map<string, EstadoCuentaRfcCandidate>();
  for (const match of upper.matchAll(FULL_RFC_IN_TEXT_RE)) {
    const rfc = normalizeRfc(match[2]);
    if (rfcShape(rfc) !== "full13") continue;
    const matchIndex = match.index ?? 0;
    const rfcIndex = matchIndex + String(match[1] ?? "").length;
    const start = Math.max(0, rfcIndex - 100);
    const end = Math.min(upper.length, rfcIndex + rfc.length + 100);
    const context = upper.slice(start, end).replace(/\s+/g, " ").trim();
    const immediateBefore = upper.slice(Math.max(0, rfcIndex - 72), rfcIndex);
    const candidate = scoreCandidate({
      rfc,
      context,
      immediateBefore,
      rfcInfonavit: args.rfcInfonavit,
      rfcDatosGenerales: args.rfcDatosGenerales,
      curpValidadaLocalmente: args.curpValidadaLocalmente,
      clienteNombre: args.clienteNombre,
    });
    const prev = dedup.get(rfc);
    if (!prev || candidate.score > prev.score) dedup.set(rfc, candidate);
  }
  return [...dedup.values()].sort((a, b) => b.score - a.score || a.rfc.localeCompare(b.rfc));
}

export function selectEstadoCuentaRfc(args: {
  text: string;
  rfcInfonavit?: string | null;
  rfcDatosGenerales?: string | null;
  curpValidadaLocalmente?: string | null;
  clienteNombre?: string | null;
}): EstadoCuentaRfcSelection {
  const candidates = extractEstadoCuentaRfcCandidates(args);
  if (candidates.length === 0) {
    return {
      status: "unknown",
      rfc: null,
      confidence: "none",
      reason: "no_full_rfc",
      candidates,
    };
  }

  const inf = normalizeRfc(args.rfcInfonavit);
  const dg = normalizeRfc(args.rfcDatosGenerales);
  const curpBase = curpRfcBase10(args.curpValidadaLocalmente);
  const candidatePool = curpBase
    ? candidates.filter((c) => c.rfc.slice(0, 10) === curpBase)
    : candidates;

  if (curpBase && candidatePool.length === 0) {
    return {
      status: "unknown",
      rfc: null,
      confidence: "none",
      reason: "curp_base_conflict",
      candidates,
    };
  }

  const hasIndependentCorroboration = Boolean(
    rfcBase10(inf) || rfcBase10(dg) || curpBase,
  );
  if (!hasIndependentCorroboration) {
    return {
      status: "unknown",
      rfc: null,
      confidence: "none",
      reason: "insufficient_corroboration",
      candidates,
    };
  }

  const exactExpected = candidatePool.filter(
    (c) =>
      (rfcShape(inf) === "full13" && c.rfc === inf) ||
      (rfcShape(dg) === "full13" && c.rfc === dg),
  );
  if (exactExpected.length === 1) {
    return {
      status: "selected",
      rfc: exactExpected[0].rfc,
      confidence: "high",
      reason: "exact_expected_match",
      candidates,
    };
  }

  const bases = [rfcBase10(inf), rfcBase10(dg)].filter(Boolean) as string[];
  const baseExpected = candidatePool.filter((c) => bases.includes(c.rfc.slice(0, 10)));
  if (baseExpected.length === 1) {
    return {
      status: "selected",
      rfc: baseExpected[0].rfc,
      confidence: "high",
      reason: "base_expected_match",
      candidates,
    };
  }

  if (curpBase && candidatePool.length === 1) {
    return {
      status: "selected",
      rfc: candidatePool[0].rfc,
      confidence: "high",
      reason: "curp_base_match",
      candidates,
    };
  }

  if (candidatePool.length === 1 && candidatePool[0].score >= 4) {
    return {
      status: "selected",
      rfc: candidatePool[0].rfc,
      confidence: "medium",
      reason: "single_contextual_candidate",
      candidates,
    };
  }

  const [first, second] = candidatePool;
  if (first && first.score >= 7 && (!second || first.score - second.score >= 4)) {
    return {
      status: "selected",
      rfc: first.rfc,
      confidence: "high",
      reason: "unique_high_score_candidate",
      candidates,
    };
  }

  return {
    status: "unknown",
    rfc: null,
    confidence: "none",
    reason: "ambiguous_candidates",
    candidates,
  };
}

export function resolveFiscalRfc(args: {
  rfcInfonavit?: string | null;
  rfcDatosGenerales?: string | null;
  estadoCuenta: EstadoCuentaRfcSelection;
}): FiscalRfcResolution {
  const fiscalRfc = args.estadoCuenta.status === "selected" ? args.estadoCuenta.rfc : null;
  if (!fiscalRfc || rfcShape(fiscalRfc) !== "full13") {
    return {
      status: "unknown",
      fiscalRfc: null,
      source: null,
      infonavitRelation: "missing",
      datosGeneralesRelation: "missing",
      shouldUpdateDatosGeneralesAfterSatPass: false,
      reason: "estado_cuenta_unknown",
    };
  }

  const infonavitRelation = relateRfc(args.rfcInfonavit, fiscalRfc);
  const datosGeneralesRelation = relateRfc(args.rfcDatosGenerales, fiscalRfc);
  return {
    status: "ready_for_sat",
    fiscalRfc,
    source: "estado_cuenta",
    infonavitRelation,
    datosGeneralesRelation,
    shouldUpdateDatosGeneralesAfterSatPass: datosGeneralesRelation !== "exact",
    reason: "estado_cuenta_selected",
  };
}

export type EstadoCuentaRfcReadSource = "embedded_text" | "ocr_cache";

export type EstadoCuentaFiscalResolution =
  | Readonly<{
      status: "ready_for_sat";
      fiscalRfc: string;
      readSource: EstadoCuentaRfcReadSource;
      selectionReason: EstadoCuentaRfcSelection["reason"];
      confidence: EstadoCuentaRfcSelection["confidence"];
      resolution: FiscalRfcResolution;
    }>
  | Readonly<{
      status: "unknown";
      fiscalRfc: null;
      readSource: null;
      embeddedReason: EstadoCuentaRfcSelection["reason"] | "no_text";
      ocrReason: EstadoCuentaRfcSelection["reason"] | "no_text";
    }>;

export function resolveEstadoCuentaFiscalRfc(args: {
  embeddedText?: string | null;
  ocrText?: string | null;
  rfcInfonavit?: string | null;
  rfcDatosGenerales?: string | null;
  curpValidadaLocalmente?: string | null;
  clienteNombre?: string | null;
}): EstadoCuentaFiscalResolution {
  const evaluate = (
    text: string | null | undefined,
    readSource: EstadoCuentaRfcReadSource,
  ):
    | Extract<EstadoCuentaFiscalResolution, { status: "ready_for_sat" }>
    | { reason: EstadoCuentaRfcSelection["reason"] | "no_text" } => {
    const clean = String(text ?? "").trim();
    if (!clean) return { reason: "no_text" };

    const selection = selectEstadoCuentaRfc({
      text: clean,
      rfcInfonavit: args.rfcInfonavit,
      rfcDatosGenerales: args.rfcDatosGenerales,
      curpValidadaLocalmente: args.curpValidadaLocalmente,
      clienteNombre: args.clienteNombre,
    });
    const resolution = resolveFiscalRfc({
      rfcInfonavit: args.rfcInfonavit,
      rfcDatosGenerales: args.rfcDatosGenerales,
      estadoCuenta: selection,
    });

    if (resolution.status === "ready_for_sat" && resolution.fiscalRfc) {
      return {
        status: "ready_for_sat",
        fiscalRfc: resolution.fiscalRfc,
        readSource,
        selectionReason: selection.reason,
        confidence: selection.confidence,
        resolution,
      };
    }
    return { reason: selection.reason };
  };

  const embedded = evaluate(args.embeddedText, "embedded_text");
  if ("status" in embedded) return embedded;

  const ocr = evaluate(args.ocrText, "ocr_cache");
  if ("status" in ocr) return ocr;

  return {
    status: "unknown",
    fiscalRfc: null,
    readSource: null,
    embeddedReason: embedded.reason,
    ocrReason: ocr.reason,
  };
}

/** Máscara segura para logs / resultado_resumido (nunca RFC completo). */
export function maskFiscalId(value: string | null | undefined): string {
  const s = normalizeRfc(value);
  if (!s) return "-";
  return `${s.slice(0, 4)}***`;
}

export type CapturedBackupPick =
  | {
      ok: true;
      rfc: string;
      field: "rfc_infonavit" | "rfc_datos_generales";
    }
  | {
      ok: false;
      reason: "missing" | "not_full13" | "curp_base_mismatch" | "curp_invalid";
    };

/**
 * Respaldo capturado: rfc_infonavit si no vacío; si vacío, RFC de datos generales.
 * Solo full13 cuya base10 coincide con la CURP del expediente.
 */
export function pickCapturedBackupRfc(args: {
  rfcInfonavit?: string | null;
  rfcDatosGenerales?: string | null;
  curpValidadaLocalmente: string;
}): CapturedBackupPick {
  const curpBase = curpRfcBase10(args.curpValidadaLocalmente);
  if (!curpBase) return { ok: false, reason: "curp_invalid" };

  const inf = normalizeRfc(args.rfcInfonavit);
  if (inf) {
    if (rfcShape(inf) !== "full13") return { ok: false, reason: "not_full13" };
    if (inf.slice(0, 10) !== curpBase) return { ok: false, reason: "curp_base_mismatch" };
    return { ok: true, rfc: inf, field: "rfc_infonavit" };
  }

  const dg = normalizeRfc(args.rfcDatosGenerales);
  if (!dg) return { ok: false, reason: "missing" };
  if (rfcShape(dg) !== "full13") return { ok: false, reason: "not_full13" };
  if (dg.slice(0, 10) !== curpBase) return { ok: false, reason: "curp_base_mismatch" };
  return { ok: true, rfc: dg, field: "rfc_datos_generales" };
}

export function homoclaveDiffers(
  rfcA: string | null | undefined,
  rfcB: string | null | undefined,
): boolean {
  const a = normalizeRfc(rfcA);
  const b = normalizeRfc(rfcB);
  if (rfcShape(a) !== "full13" || rfcShape(b) !== "full13") return false;
  if (a.slice(0, 10) !== b.slice(0, 10)) return false;
  return a.slice(10) !== b.slice(10);
}

export type FiscalBackupReason =
  | "pdf_PDF_NO_LEGIBLE"
  | "pdf_ERROR_ANALISIS"
  | "pdf_no_full_rfc"
  | "pdf_curp_base_conflict"
  | "pdf_insufficient_corroboration"
  | "pdf_ambiguous_candidates"
  | "pdf_estado_cuenta_unknown"
  | "pdf_sat_invalid"
  | (string & {});

export type FiscalValidadoResumen = Readonly<{
  source: "sat_worker";
  semantic: "pass";
  rfc_source: "estado_cuenta" | "respaldo_capturado";
  fiscal_rfc_masked: string;
  edc_read_source?: EstadoCuentaRfcReadSource;
  backup_reason?: FiscalBackupReason;
  backup_field?: "rfc_infonavit" | "rfc_datos_generales";
  pdf_homoclave_differed?: boolean;
  pdf_rfc_masked?: string;
}>;

export function buildValidadoResumen(args: {
  fiscalRfc: string;
  rfcSource: "estado_cuenta" | "respaldo_capturado";
  edcReadSource?: EstadoCuentaRfcReadSource;
  backupReason?: FiscalBackupReason;
  backupField?: "rfc_infonavit" | "rfc_datos_generales";
  pdfRfc?: string | null;
}): FiscalValidadoResumen {
  const base: FiscalValidadoResumen = {
    source: "sat_worker",
    semantic: "pass",
    rfc_source: args.rfcSource,
    fiscal_rfc_masked: maskFiscalId(args.fiscalRfc),
  };
  if (args.rfcSource === "estado_cuenta") {
    return {
      ...base,
      edc_read_source: args.edcReadSource,
    };
  }
  const pdfMasked = args.pdfRfc ? maskFiscalId(args.pdfRfc) : undefined;
  return {
    ...base,
    backup_reason: args.backupReason,
    backup_field: args.backupField,
    pdf_homoclave_differed: args.pdfRfc
      ? homoclaveDiffers(args.pdfRfc, args.fiscalRfc)
      : undefined,
    pdf_rfc_masked: pdfMasked,
  };
}

/** Presupuesto total acordado para llamadas al worker en la route. */
export const FISCAL_ROUTE_BUDGET_MS = 50_000;
/** Mínimo para intentar un segundo validate (respaldo); si no cabe → REVISION_MANUAL. */
export const FISCAL_MIN_BACKUP_ATTEMPT_MS = 8_000;

export function remainingFiscalBudgetMs(deadlineAt: number, now = Date.now()): number {
  return Math.max(0, deadlineAt - now);
}

export function workerAttemptTimeoutMs(
  remainingMs: number,
  opts?: { minMs?: number },
): number | null {
  const minMs = opts?.minMs ?? FISCAL_MIN_BACKUP_ATTEMPT_MS;
  if (remainingMs < minMs) return null;
  return Math.min(FISCAL_ROUTE_BUDGET_MS, remainingMs);
}

/**
 * Plan del 2º intento (tryBackup): decide validar respaldo, INVALIDO, RM o sin cupo.
 * Usado por la route para no duplicar ramas.
 */
export type FiscalBackupAttemptPlan =
  | { kind: "validate"; timeoutMs: number }
  | { kind: "register_invalid_pdf" }
  | { kind: "revision_manual"; code: string }
  | { kind: "budget_exceeded" };

export function planFiscalBackupAttempt(args: {
  remainingMs: number;
  backup: CapturedBackupPick;
  afterPdfInvalid: boolean;
  hasPdfRfc: boolean;
}): FiscalBackupAttemptPlan {
  if (!args.backup.ok) {
    if (args.afterPdfInvalid && args.hasPdfRfc) {
      return { kind: "register_invalid_pdf" };
    }
    return {
      kind: "revision_manual",
      code: `RFC_NO_RESUELTO_BACKUP_${args.backup.reason.toUpperCase()}`,
    };
  }
  const timeoutMs = workerAttemptTimeoutMs(args.remainingMs);
  if (timeoutMs == null) return { kind: "budget_exceeded" };
  return { kind: "validate", timeoutMs };
}

export function backupReasonFromPdfGap(args: {
  extractOk: boolean;
  extractReason?: string | null;
  selectionReason?: string | null;
}): FiscalBackupReason {
  if (!args.extractOk) {
    const r = String(args.extractReason ?? "ERROR_ANALISIS");
    return `pdf_${r}` as FiscalBackupReason;
  }
  const sel = String(args.selectionReason ?? "estado_cuenta_unknown");
  return `pdf_${sel}` as FiscalBackupReason;
}
