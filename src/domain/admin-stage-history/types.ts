import { z } from "zod";
import {
  ETAPAS_VISUALES_OPERATIVAS,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
} from "@/domain/expedientes/asesor-seguimiento-operativo";

export const ADMIN_STAGE_HISTORY_MOVIMIENTOS = [
  "entrada",
  "avance",
  "estuvieron",
  "estado_actual",
] as const;
export type AdminStageHistoryMovimiento =
  (typeof ADMIN_STAGE_HISTORY_MOVIMIENTOS)[number];

export const ADMIN_STAGE_HISTORY_ESTADOS = [
  "todos",
  "activos",
  "rechazados",
  "cancelados",
] as const;
export type AdminStageHistoryEstado = (typeof ADMIN_STAGE_HISTORY_ESTADOS)[number];

export const ADMIN_STAGE_HISTORY_RESULTADOS = [
  "avanzo",
  "continua",
  "rechazado",
  "retrocedio",
  "cancelado",
  "salio",
] as const;
export type AdminStageHistoryResultado =
  (typeof ADMIN_STAGE_HISTORY_RESULTADOS)[number];

export const adminStageHistoryMovimientoSchema = z.enum(
  ADMIN_STAGE_HISTORY_MOVIMIENTOS,
);
export const adminStageHistoryEstadoSchema = z.enum(ADMIN_STAGE_HISTORY_ESTADOS);
export const adminStageHistoryResultadoSchema = z.enum(
  ADMIN_STAGE_HISTORY_RESULTADOS,
);

export const ADMIN_STAGE_HISTORY_MOVIMIENTO_OPTIONS: ReadonlyArray<{
  value: AdminStageHistoryMovimiento;
  label: string;
}> = [
  { value: "entrada", label: "Entraron" },
  { value: "avance", label: "Avanzaron" },
  { value: "estuvieron", label: "Estuvieron" },
  { value: "estado_actual", label: "Estado actual (referencia)" },
];

export const ADMIN_STAGE_HISTORY_ESTADO_OPTIONS: ReadonlyArray<{
  value: AdminStageHistoryEstado;
  label: string;
}> = [
  { value: "todos", label: "Todos" },
  { value: "activos", label: "Solo activos" },
  { value: "rechazados", label: "Solo rechazados" },
  { value: "cancelados", label: "Solo cancelados" },
];

export const DEFAULT_ADMIN_STAGE_HISTORY_MOVIMIENTO: AdminStageHistoryMovimiento =
  "entrada";

export const ADMIN_STAGE_HISTORY_PASO_OPTIONS = ETAPAS_VISUALES_OPERATIVAS.map(
  (e) => ({
    value: e.pasoVisual,
    label: `Paso ${e.pasoVisual} · ${e.nombre}`,
  }),
);

export const ADMIN_STAGE_HISTORY_ALL_PASO_VALUES: readonly number[] =
  ETAPAS_VISUALES_OPERATIVAS.map((e) => e.pasoVisual);

export const ADMIN_STAGE_HISTORY_TIMEZONE = "America/Monterrey" as const;

export const adminStageHistoryTotalesSchema = z.object({
  total_expedientes_unicos: z.number().int().nonnegative(),
  total_visitas: z.number().int().nonnegative(),
  entered_count: z.number().int().nonnegative(),
  advanced_count: z.number().int().nonnegative(),
  current_count: z.number().int().nonnegative(),
  rejected_count: z.number().int().nonnegative(),
  returned_count: z.number().int().nonnegative(),
  avg_duration_seconds: z.number().int().nonnegative().nullable(),
  median_duration_seconds: z.number().int().nonnegative().nullable(),
});

export const adminStageHistoryResumenEtapaSchema = z.object({
  paso_visual: z.number().int().min(1).max(11),
  paso_nombre: z.string(),
  entered_count: z.number().int().nonnegative(),
  advanced_count: z.number().int().nonnegative(),
  current_count: z.number().int().nonnegative(),
  rejected_count: z.number().int().nonnegative(),
  returned_count: z.number().int().nonnegative(),
  visitas: z.number().int().nonnegative(),
  expedientes_unicos: z.number().int().nonnegative(),
  avg_duration_seconds: z.number().int().nonnegative().nullable(),
  median_duration_seconds: z.number().int().nonnegative().nullable(),
  tasa_avance: z.number().nullable(),
  tasa_pendiente: z.number().nullable(),
});

export const adminStageHistorySummarySchema = z.object({
  totales: adminStageHistoryTotalesSchema,
  resumen_por_etapa: z.array(adminStageHistoryResumenEtapaSchema),
  generated_at: z.string(),
  history_coverage_from: z.string().nullable(),
  movimiento: adminStageHistoryMovimientoSchema,
  nota: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  asesor_fuente: z.literal("actual").nullable().optional(),
  fecha_desde: z.string().nullable().optional(),
  fecha_hasta: z.string().nullable().optional(),
});

export const adminStageHistoryItemSchema = z.object({
  visita_id: z.string().uuid(),
  expediente_id: z.string().uuid(),
  cliente_nombre: z.string(),
  nss: z.string(),
  asesor_id: z.string().uuid().nullable().optional(),
  asesor_nombre: z.string().nullable(),
  asesor_fuente: z.literal("actual").nullable().optional(),
  programa: z.string().nullable().optional(),
  paso_visual: z.number().int().min(1).max(11),
  paso_nombre: z.string(),
  etapa_entrada: z.number().int().nullable().optional(),
  paso_origen: z.number().int().nullable().optional(),
  etapa_origen: z.number().int().nullable().optional(),
  entered_at: z.string().nullable(),
  exited_at: z.string().nullable(),
  movimiento_at: z.string().nullable().optional(),
  duration_seconds: z.number().int().nonnegative().nullable(),
  duration_in_range_seconds: z.number().int().nonnegative().nullable().optional(),
  still_in_stage_at_range_end: z.boolean().nullable().optional(),
  resultado: adminStageHistoryResultadoSchema,
  etapa_siguiente_paso: z.number().int().nullable().optional(),
  etapa_siguiente: z.number().int().nullable().optional(),
  etapa_actual: z.number().int().nullable().optional(),
  paso_actual: z.number().int().nullable().optional(),
  ciclo_estado: z.string().nullable().optional(),
  subestado: z.string().nullable().optional(),
  fecha_envio_mesa: z.string().nullable().optional(),
  actor_user_id: z.string().uuid().nullable().optional(),
  actor_nombre: z.string().nullable().optional(),
  motivo: z.string().nullable().optional(),
});

export const adminStageHistoryPageSchema = z.object({
  items: z.array(adminStageHistoryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  history_coverage_from: z.string().nullable(),
  movimiento: adminStageHistoryMovimientoSchema,
  timezone: z.string().nullable().optional(),
  asesor_fuente: z.literal("actual").nullable().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export type AdminStageHistoryTotales = z.infer<
  typeof adminStageHistoryTotalesSchema
>;
export type AdminStageHistoryResumenEtapa = z.infer<
  typeof adminStageHistoryResumenEtapaSchema
>;
export type AdminStageHistorySummary = z.infer<
  typeof adminStageHistorySummarySchema
>;
export type AdminStageHistoryItem = z.infer<typeof adminStageHistoryItemSchema>;
export type AdminStageHistoryPage = z.infer<typeof adminStageHistoryPageSchema>;

export type AdminStageHistoryFilters = Readonly<{
  asesorIds: readonly string[];
  pasosVisuales: readonly number[];
  movimiento: AdminStageHistoryMovimiento;
  estadoActual: AdminStageHistoryEstado;
  fechaDesde: string | null;
  fechaHasta: string | null;
  buscar: string | null;
}>;

export const DEFAULT_ADMIN_STAGE_HISTORY_PAGE_SIZE = 25;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAdminStageHistoryPasos(
  pasos: readonly number[],
): { ok: true } | { ok: false; message: string } {
  if (
    pasos.some(
      (p) =>
        !Number.isInteger(p) ||
        p < 1 ||
        p > TOTAL_PASOS_VISUALES_OPERATIVOS,
    )
  ) {
    return { ok: false, message: "Los pasos deben estar entre 1 y 11." };
  }
  return { ok: true };
}

export function validateAdminStageHistoryFechaRango(
  desde: string | null | undefined,
  hasta: string | null | undefined,
): { ok: true } | { ok: false; message: string } {
  const d = desde?.trim() || null;
  const h = hasta?.trim() || null;
  if (d && !YMD_RE.test(d)) {
    return { ok: false, message: "La fecha Desde no es válida." };
  }
  if (h && !YMD_RE.test(h)) {
    return { ok: false, message: "La fecha Hasta no es válida." };
  }
  if (d && h && d > h) {
    return {
      ok: false,
      message: "La fecha Desde no puede ser posterior a Hasta.",
    };
  }
  return { ok: true };
}

export function adminStageHistoryRequiresFechas(
  movimiento: AdminStageHistoryMovimiento,
): boolean {
  return movimiento !== "estado_actual";
}

export function canConsultAdminStageHistory(
  filters: AdminStageHistoryFilters,
): boolean {
  if (filters.asesorIds.length === 0 || filters.pasosVisuales.length === 0) {
    return false;
  }
  if (!adminStageHistoryRequiresFechas(filters.movimiento)) {
    return true;
  }
  return Boolean(filters.fechaDesde?.trim() && filters.fechaHasta?.trim());
}

export function buildAdminStageHistoryRpcPayload(
  filters: AdminStageHistoryFilters,
): Readonly<{
  p_asesor_ids: string[];
  p_pasos_visuales: number[];
  p_movimiento: AdminStageHistoryMovimiento;
  p_fecha_desde: string | null;
  p_fecha_hasta: string | null;
  p_estado_actual: string | null;
  p_buscar: string | null;
}> {
  const estado =
    filters.estadoActual === "todos" ? null : filters.estadoActual;
  const requiereFechas = adminStageHistoryRequiresFechas(filters.movimiento);
  return {
    p_asesor_ids: [...filters.asesorIds],
    p_pasos_visuales: [...filters.pasosVisuales],
    p_movimiento: filters.movimiento,
    p_fecha_desde: requiereFechas ? filters.fechaDesde?.trim() || null : null,
    p_fecha_hasta: requiereFechas ? filters.fechaHasta?.trim() || null : null,
    p_estado_actual: estado,
    p_buscar: filters.buscar?.trim() || null,
  };
}

export function labelAdminStageHistoryMovimiento(
  movimiento: AdminStageHistoryMovimiento,
): string {
  return (
    ADMIN_STAGE_HISTORY_MOVIMIENTO_OPTIONS.find((o) => o.value === movimiento)
      ?.label ?? movimiento
  );
}

export function labelAdminStageHistoryResultado(
  resultado: AdminStageHistoryResultado,
): string {
  switch (resultado) {
    case "avanzo":
      return "Avanzó";
    case "continua":
      return "Continúa";
    case "rechazado":
      return "Rechazado";
    case "retrocedio":
      return "Retrocedió";
    case "cancelado":
      return "Cancelado";
    case "salio":
      return "Salió";
    default:
      return resultado;
  }
}

export function formatAdminStageHistoryTimestamp(
  iso: string | null | undefined,
): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("es-MX", {
    timeZone: ADMIN_STAGE_HISTORY_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatHistoryCoverageFrom(
  iso: string | null | undefined,
): string {
  if (!iso) return "fecha desconocida";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "fecha desconocida";
  return dt.toLocaleDateString("es-MX", {
    timeZone: ADMIN_STAGE_HISTORY_TIMEZONE,
    dateStyle: "long",
  });
}

export function formatDurationSeconds(
  seconds: number | null | undefined,
): string {
  if (seconds == null || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins} min`;
  return `${seconds}s`;
}

export function formatAdminStageHistoryMetaSummary(
  summary: AdminStageHistorySummary,
  consulted?: Pick<AdminStageHistoryFilters, "asesorIds" | "pasosVisuales"> | null,
): string {
  const asesoresSel = consulted?.asesorIds.length ?? 0;
  const etapasSel = consulted?.pasosVisuales.length ?? 0;
  const n = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;

  return [
    n(asesoresSel, "asesor seleccionado", "asesores seleccionados"),
    n(etapasSel, "etapa consultada", "etapas consultadas"),
    n(summary.totales.total_expedientes_unicos, "expediente único", "expedientes únicos"),
    n(summary.totales.total_visitas, "movimiento", "movimientos"),
  ].join(" · ");
}

/* ─── P153/P154: resultado de cohorte por entrada ─── */

export const ADMIN_STAGE_COHORT_PERIOD_OUTCOMES = [
  "advanced",
  "stayed",
  "incident",
  "undetermined",
] as const;
export type AdminStageCohortPeriodOutcome =
  (typeof ADMIN_STAGE_COHORT_PERIOD_OUTCOMES)[number];

export const ADMIN_STAGE_COHORT_OUTCOMES = [
  "entered",
  ...ADMIN_STAGE_COHORT_PERIOD_OUTCOMES,
] as const;
export type AdminStageCohortOutcome =
  (typeof ADMIN_STAGE_COHORT_OUTCOMES)[number];

export const ADMIN_STAGE_COHORT_SITUACIONES = [
  "sigue_en_etapa",
  "avanzo_despues",
  "retrocedio_despues",
  "salio_despues",
  "cerrado_inactivo",
  "avanzo_en_periodo",
  "incidencia_en_periodo",
  "no_determinado",
] as const;
export type AdminStageCohortSituacion =
  (typeof ADMIN_STAGE_COHORT_SITUACIONES)[number];

export const adminStageCohortPeriodOutcomeSchema = z.enum(
  ADMIN_STAGE_COHORT_PERIOD_OUTCOMES,
);
export const adminStageCohortOutcomeSchema = z.enum(ADMIN_STAGE_COHORT_OUTCOMES);
export const adminStageCohortSituacionSchema = z.enum(
  ADMIN_STAGE_COHORT_SITUACIONES,
);

export const adminStageCohortAsesorSchema = z.object({
  asesor_id: z.string().uuid().nullable(),
  asesor_nombre: z.string(),
  asesor_email: z.string().nullable().optional(),
  entered_count: z.number().int().nonnegative(),
  advanced_count: z.number().int().nonnegative(),
  stayed_count: z.number().int().nonnegative(),
  incident_count: z.number().int().nonnegative(),
  undetermined_count: z.number().int().nonnegative(),
});

export const adminStageCohortEtapaSchema = z.object({
  paso_visual: z.number().int().min(1).max(11),
  etapa_label: z.string(),
  entered_count: z.number().int().nonnegative(),
  advanced_count: z.number().int().nonnegative(),
  stayed_count: z.number().int().nonnegative(),
  incident_count: z.number().int().nonnegative(),
  undetermined_count: z.number().int().nonnegative(),
  advance_rate: z.number().nullable(),
  stayed_rate: z.number().nullable(),
  avg_advance_duration_seconds: z.number().int().nonnegative().nullable(),
  median_advance_duration_seconds: z.number().int().nonnegative().nullable(),
  por_asesor: z.array(adminStageCohortAsesorSchema).optional().default([]),
});

export const adminStageCohortSummarySchema = z.object({
  etapas: z.array(adminStageCohortEtapaSchema),
  generated_at: z.string(),
  history_coverage_from: z.string().nullable(),
  fecha_desde: z.string().nullable().optional(),
  fecha_hasta: z.string().nullable().optional(),
  nota: z.string().nullable().optional(),
});

export const adminStageCohortItemSchema = z.object({
  visita_id: z.string().uuid(),
  expediente_id: z.string().uuid(),
  cliente_nombre: z.string(),
  nss: z.string(),
  asesor_id: z.string().uuid().nullable().optional(),
  asesor_nombre: z.string().nullable(),
  asesor_email: z.string().nullable().optional(),
  programa: z.string().nullable().optional(),
  paso_visual: z.number().int().min(1).max(11),
  etapa_label: z.string(),
  etapa_entrada: z.number().int().nullable().optional(),
  entered_at: z.string(),
  exited_at: z.string().nullable(),
  duration_seconds: z.number().int().nonnegative().nullable(),
  period_outcome: adminStageCohortPeriodOutcomeSchema,
  resultado_label: adminStageHistoryResultadoSchema,
  etapa_siguiente_paso: z.number().int().nullable().optional(),
  etapa_siguiente: z.number().int().nullable().optional(),
  etapa_siguiente_label: z.string().nullable().optional(),
  etapa_actual: z.number().int().nullable().optional(),
  paso_actual: z.number().int().nullable().optional(),
  situacion_actual: adminStageCohortSituacionSchema,
  motivo: z.string().nullable().optional(),
  fecha_envio_mesa: z.string().nullable().optional(),
});

export const adminStageCohortPageSchema = z.object({
  items: z.array(adminStageCohortItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  resultado: adminStageCohortOutcomeSchema,
  nss_completo: z.boolean().optional(),
  history_coverage_from: z.string().nullable(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export type AdminStageCohortAsesor = z.infer<typeof adminStageCohortAsesorSchema>;
export type AdminStageCohortEtapa = z.infer<typeof adminStageCohortEtapaSchema>;
export type AdminStageCohortSummary = z.infer<
  typeof adminStageCohortSummarySchema
>;
export type AdminStageCohortItem = z.infer<typeof adminStageCohortItemSchema>;
export type AdminStageCohortPage = z.infer<typeof adminStageCohortPageSchema>;

export const DEFAULT_ADMIN_STAGE_COHORT_PAGE_SIZE = 25;

export function canShowAdminStageCohortOutcomes(
  filters: AdminStageHistoryFilters | null | undefined,
): boolean {
  if (!filters) return false;
  if (filters.pasosVisuales.length === 0) return false;
  const d = filters.fechaDesde?.trim();
  const h = filters.fechaHasta?.trim();
  if (!d || !h) return false;
  return validateAdminStageHistoryFechaRango(d, h).ok;
}

export function buildAdminStageCohortRpcPayload(
  filters: AdminStageHistoryFilters,
): Readonly<{
  p_asesor_ids: string[];
  p_pasos_visuales: number[];
  p_fecha_desde: string;
  p_fecha_hasta: string;
  p_estado_actual: string | null;
  p_buscar: string | null;
}> {
  const estado =
    filters.estadoActual === "todos" ? null : filters.estadoActual;
  return {
    p_asesor_ids: [...filters.asesorIds],
    p_pasos_visuales: [...filters.pasosVisuales],
    p_fecha_desde: filters.fechaDesde!.trim(),
    p_fecha_hasta: filters.fechaHasta!.trim(),
    p_estado_actual: estado,
    p_buscar: filters.buscar?.trim() || null,
  };
}

export function labelAdminStageCohortOutcome(
  outcome: AdminStageCohortOutcome | AdminStageCohortPeriodOutcome,
): string {
  switch (outcome) {
    case "entered":
      return "Entraron";
    case "advanced":
      return "Avanzaron";
    case "stayed":
      return "Se quedaron al cierre";
    case "incident":
      return "Rechazados o retrocedieron";
    case "undetermined":
      return "No determinados";
    default:
      return outcome;
  }
}

export function labelAdminStageCohortSituacion(
  situacion: AdminStageCohortSituacion,
): string {
  switch (situacion) {
    case "sigue_en_etapa":
      return "Sigue actualmente en esa etapa.";
    case "avanzo_despues":
      return "Avanzó después del periodo.";
    case "retrocedio_despues":
      return "Retrocedió después del periodo.";
    case "salio_despues":
      return "Salió después del periodo.";
    case "cerrado_inactivo":
      return "Expediente cerrado/inactivo.";
    case "avanzo_en_periodo":
      return "Avanzó dentro del periodo.";
    case "incidencia_en_periodo":
      return "Incidencia dentro del periodo.";
    case "no_determinado":
      return "Situación no determinada.";
    default:
      return situacion;
  }
}

export function cohortEtapaCuadra(etapa: AdminStageCohortEtapa): boolean {
  return (
    etapa.entered_count ===
    etapa.advanced_count +
      etapa.stayed_count +
      etapa.incident_count +
      etapa.undetermined_count
  );
}
