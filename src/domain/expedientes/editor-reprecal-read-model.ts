/**
 * P185 — read model Editor para re-precal (SELECT only).
 * No muta editor_decisions ni intentos.
 */
import { z } from "zod";
import type { EditorDecision, ExpedienteMock } from "./mock.repo";

export type EditorReprecalEstado = "pending" | "approved" | "no_cumple";

export type EditorReprecalMeta = Readonly<{
  estado: EditorReprecalEstado;
  intentoId: string | null;
  solicitadaAt: string | null;
  resueltaAt: string | null;
  montoResultado: number | null;
  notasResultado: string;
  programaSolicitado: string | null;
}>;

export type EditorReprecalIntentoRow = Readonly<{
  id: string;
  expediente_id: string;
  decision: string | null;
  monto_aprobado: number | string | null;
  notas_revision: string | null;
  decision_previa: string | null;
  idempotency_key: string | null;
  created_at: string | null;
  decided_at: string | null;
  programa_solicitado: string | null;
}>;

export const editorReprecalIntentoRowSchema = z.object({
  id: z.string().min(1),
  expediente_id: z.string().min(1),
  decision: z.string().nullable().optional(),
  monto_aprobado: z.union([z.number(), z.string(), z.null()]).optional(),
  notas_revision: z.string().nullable().optional(),
  decision_previa: z.string().nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  decided_at: z.string().nullable().optional(),
  programa_solicitado: z.string().nullable().optional(),
});

export const EDITOR_REPRECAL_INTENTOS_SELECT =
  "id, expediente_id, decision, monto_aprobado, notas_revision, decision_previa, idempotency_key, created_at, decided_at, programa_solicitado";

function emptyToNull(value: string | null | undefined): string | null {
  const t = String(value ?? "").trim();
  return t ? t : null;
}

function parseMonto(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** P183: intento REAL = decision_previa IS NOT NULL OR idempotency_key no vacío. */
export function isEditorReprecalIntentoReal(
  row: Pick<EditorReprecalIntentoRow, "decision_previa" | "idempotency_key">,
): boolean {
  return (
    emptyToNull(row.decision_previa) != null ||
    emptyToNull(row.idempotency_key) != null
  );
}

export function isEditorReprecalDecisionResuelta(
  decision: string | null | undefined,
): decision is "aprobado" | "no_cumple" {
  return decision === "aprobado" || decision === "no_cumple";
}

function decidedAtSortValue(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function createdAtSortValue(iso: string | null | undefined): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

/** decided_at DESC NULLS LAST, created_at DESC, id DESC. */
export function compareEditorReprecalIntentosDesc(
  a: EditorReprecalIntentoRow,
  b: EditorReprecalIntentoRow,
): number {
  const decided = decidedAtSortValue(b.decided_at) - decidedAtSortValue(a.decided_at);
  if (decided !== 0) return decided;
  const created = createdAtSortValue(b.created_at) - createdAtSortValue(a.created_at);
  if (created !== 0) return created;
  return String(b.id).localeCompare(String(a.id));
}

export function pickLatestResolvedRealReprecalIntento(
  rows: readonly EditorReprecalIntentoRow[],
): EditorReprecalIntentoRow | null {
  const resolved = rows.filter(
    (row) =>
      isEditorReprecalIntentoReal(row) &&
      isEditorReprecalDecisionResuelta(row.decision ?? null),
  );
  if (resolved.length === 0) return null;
  return [...resolved].sort(compareEditorReprecalIntentosDesc)[0] ?? null;
}

export function parseEditorReprecalIntentoRows(
  raw: unknown,
): EditorReprecalIntentoRow[] {
  if (!Array.isArray(raw)) return [];
  const out: EditorReprecalIntentoRow[] = [];
  for (const item of raw) {
    const parsed = editorReprecalIntentoRowSchema.safeParse(item);
    if (!parsed.success) continue;
    const row = parsed.data;
    out.push({
      id: row.id,
      expediente_id: row.expediente_id,
      decision: row.decision ?? null,
      monto_aprobado: row.monto_aprobado ?? null,
      notas_revision: row.notas_revision ?? null,
      decision_previa: row.decision_previa ?? null,
      idempotency_key: row.idempotency_key ?? null,
      created_at: row.created_at ?? null,
      decided_at: row.decided_at ?? null,
      programa_solicitado: row.programa_solicitado ?? null,
    });
  }
  return out;
}

export function metaFromResolvedIntento(
  row: EditorReprecalIntentoRow,
): EditorReprecalMeta {
  const estado: EditorReprecalEstado =
    row.decision === "aprobado" ? "approved" : "no_cumple";
  return {
    estado,
    intentoId: row.id,
    solicitadaAt: row.created_at,
    resueltaAt: row.decided_at,
    montoResultado: estado === "approved" ? parseMonto(row.monto_aprobado) : null,
    notasResultado: String(row.notas_revision ?? "").trim(),
    programaSolicitado: emptyToNull(row.programa_solicitado),
  };
}

/**
 * Sidecar por expediente: solo re-precal REAL resuelta.
 * Pending se deriva del FK `reprecalificacionPendienteId` del expediente.
 */
export function buildEditorReprecalSidecar(
  intentos: readonly EditorReprecalIntentoRow[],
): Readonly<Record<string, EditorReprecalMeta>> {
  const byExp = new Map<string, EditorReprecalIntentoRow[]>();
  for (const row of intentos) {
    const id = String(row.expediente_id ?? "").trim();
    if (!id) continue;
    const list = byExp.get(id) ?? [];
    list.push(row);
    byExp.set(id, list);
  }
  const out: Record<string, EditorReprecalMeta> = {};
  for (const [expedienteId, rows] of byExp) {
    const latest = pickLatestResolvedRealReprecalIntento(rows);
    if (!latest) continue;
    out[expedienteId] = metaFromResolvedIntento(latest);
  }
  return out;
}

export type EditorRevisionDisplay = Readonly<{
  decision: EditorDecision;
  monto_aprobado: number | null;
  notas_revision: string;
  esReprecalPendiente: boolean;
  reprecalResuelta: boolean;
}>;

/** Presentación de la última revisión Editor. No muta editorDecision vigente. */
export function editorRevisionDisplay(
  exp: Pick<ExpedienteMock, "editorDecision" | "reprecalificacionPendienteId">,
  meta?: EditorReprecalMeta | null,
): EditorRevisionDisplay {
  const pendingId = emptyToNull(exp.reprecalificacionPendienteId ?? null);
  if (pendingId) {
    return {
      decision: "pendiente",
      monto_aprobado: null,
      notas_revision: "",
      esReprecalPendiente: true,
      reprecalResuelta: false,
    };
  }
  if (meta?.estado === "approved") {
    return {
      decision: "aprobado",
      monto_aprobado: meta.montoResultado,
      notas_revision: meta.notasResultado,
      esReprecalPendiente: false,
      reprecalResuelta: true,
    };
  }
  if (meta?.estado === "no_cumple") {
    return {
      decision: "no_cumple",
      monto_aprobado: null,
      notas_revision: meta.notasResultado,
      esReprecalPendiente: false,
      reprecalResuelta: true,
    };
  }
  return {
    decision: exp.editorDecision.decision,
    monto_aprobado: exp.editorDecision.monto_aprobado,
    notas_revision: exp.editorDecision.notas_revision,
    esReprecalPendiente: false,
    reprecalResuelta: false,
  };
}

export const MSG_EDITOR_REPRECAL_EMPTY =
  "Captura un monto aprobado o una nota de no cumplimiento.";
