import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  adminStageCohortPageSchema,
  adminStageCohortSummarySchema,
  adminStageHistoryPageSchema,
  adminStageHistorySummarySchema,
  buildAdminStageCohortRpcPayload,
  buildAdminStageHistoryRpcPayload,
  canConsultAdminStageHistory,
  canShowAdminStageCohortOutcomes,
  validateAdminStageHistoryFechaRango,
  type AdminStageCohortItem,
  type AdminStageCohortOutcome,
  type AdminStageCohortPage,
  type AdminStageCohortSummary,
  type AdminStageHistoryFilters,
  type AdminStageHistoryItem,
  type AdminStageHistoryPage,
  type AdminStageHistorySummary,
} from "./types";

export class AdminStageHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminStageHistoryError";
  }
}

function mapRpcError(error: { message?: string }): never {
  const msg = error.message ?? "";
  if (/solo super_admin|admin_production/i.test(msg)) {
    throw new AdminStageHistoryError(
      "Solo Super Admin puede consultar este reporte.",
    );
  }
  if (
    /p_movimiento inválido|p_estado_actual inválido|p_pasos_visuales|p_fecha_desde|p_resultado|admin_stage_cohort/i.test(
      msg,
    )
  ) {
    throw new AdminStageHistoryError(
      "Filtros inválidos. Revisa movimiento, etapas, estado, fechas y búsqueda.",
    );
  }
  throw new AdminStageHistoryError(
    "No se pudo cargar el reporte histórico de etapas.",
  );
}

function assertConsultable(filters: AdminStageHistoryFilters): void {
  const fechaCheck = validateAdminStageHistoryFechaRango(
    filters.fechaDesde,
    filters.fechaHasta,
  );
  if (!fechaCheck.ok) {
    throw new AdminStageHistoryError(fechaCheck.message);
  }
  if (!canConsultAdminStageHistory(filters)) {
    throw new AdminStageHistoryError(
      "Selecciona al menos un asesor y una etapa; para movimientos históricos indica rango de fechas.",
    );
  }
}

export async function fetchAdminStageHistorySummary(
  filters: AdminStageHistoryFilters,
): Promise<AdminStageHistorySummary> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminStageHistoryError("Supabase no configurado");
  }
  assertConsultable(filters);

  const payload = buildAdminStageHistoryRpcPayload(filters);
  const { data, error } = await supabaseBrowser.rpc(
    "admin_stage_history_report_summary",
    payload,
  );
  if (error) mapRpcError(error);

  const parsed = adminStageHistorySummarySchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminStageHistoryError(
      "La respuesta del resumen no es válida.",
    );
  }
  return parsed.data;
}

export async function fetchAdminStageHistoryPage(
  filters: AdminStageHistoryFilters,
  page: number,
  pageSize: number,
): Promise<AdminStageHistoryPage> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminStageHistoryError("Supabase no configurado");
  }
  assertConsultable(filters);

  const payload = {
    p_page: page,
    p_page_size: pageSize,
    ...buildAdminStageHistoryRpcPayload(filters),
  };
  const { data, error } = await supabaseBrowser.rpc(
    "admin_stage_history_report_page",
    payload,
  );
  if (error) mapRpcError(error);

  const parsed = adminStageHistoryPageSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminStageHistoryError(
      "La respuesta del detalle paginado no es válida.",
    );
  }
  return parsed.data;
}

/** Descarga todas las páginas para exportación Excel. */
export async function fetchAdminStageHistoryAllItems(
  filters: AdminStageHistoryFilters,
  pageSize = 100,
): Promise<readonly AdminStageHistoryItem[]> {
  const first = await fetchAdminStageHistoryPage(filters, 1, pageSize);
  const all: AdminStageHistoryItem[] = [...first.items];
  const totalPages = Math.ceil(first.total / pageSize);
  for (let p = 2; p <= totalPages; p += 1) {
    const next = await fetchAdminStageHistoryPage(filters, p, pageSize);
    all.push(...next.items);
  }
  return all;
}

export async function fetchAdminStageCohortSummary(
  filters: AdminStageHistoryFilters,
): Promise<AdminStageCohortSummary> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminStageHistoryError("Supabase no configurado");
  }
  if (!canShowAdminStageCohortOutcomes(filters)) {
    throw new AdminStageHistoryError(
      "El resultado de cohorte requiere etapas y rango de fechas.",
    );
  }

  const payload = buildAdminStageCohortRpcPayload(filters);
  const { data, error } = await supabaseBrowser.rpc(
    "admin_stage_cohort_outcome_summary",
    payload,
  );
  if (error) mapRpcError(error);

  const parsed = adminStageCohortSummarySchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminStageHistoryError(
      "La respuesta del resultado por etapa no es válida.",
    );
  }
  return parsed.data;
}

export async function fetchAdminStageCohortPage(
  filters: AdminStageHistoryFilters,
  resultado: AdminStageCohortOutcome,
  limit: number,
  offset: number,
  pasosOverride?: readonly number[],
): Promise<AdminStageCohortPage> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminStageHistoryError("Supabase no configurado");
  }
  if (!canShowAdminStageCohortOutcomes(filters)) {
    throw new AdminStageHistoryError(
      "El resultado de cohorte requiere etapas y rango de fechas.",
    );
  }

  const base = buildAdminStageCohortRpcPayload(filters);
  const payload = {
    ...base,
    p_pasos_visuales: pasosOverride?.length
      ? [...pasosOverride]
      : base.p_pasos_visuales,
    p_resultado: resultado,
    p_limit: limit,
    p_offset: offset,
  };
  const { data, error } = await supabaseBrowser.rpc(
    "admin_stage_cohort_outcome_page",
    payload,
  );
  if (error) mapRpcError(error);

  const parsed = adminStageCohortPageSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminStageHistoryError(
      "La respuesta del detalle de cohorte no es válida.",
    );
  }
  return parsed.data;
}

/** Todas las visitas de cohorte para Excel (resultado entered = cohorte completa). */
export async function fetchAdminStageCohortAllItems(
  filters: AdminStageHistoryFilters,
  pageSize = 100,
): Promise<readonly AdminStageCohortItem[]> {
  const all: AdminStageCohortItem[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await fetchAdminStageCohortPage(
      filters,
      "entered",
      pageSize,
      offset,
    );
    all.push(...page.items);
    total = page.total;
    offset += pageSize;
    if (page.items.length === 0) break;
  }
  return all;
}
