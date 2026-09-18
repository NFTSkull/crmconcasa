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
