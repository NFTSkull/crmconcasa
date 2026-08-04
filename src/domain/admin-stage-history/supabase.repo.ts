import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  adminStageHistoryPageSchema,
  adminStageHistorySummarySchema,
  buildAdminStageHistoryRpcPayload,
  canConsultAdminStageHistory,
  validateAdminStageHistoryFechaRango,
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
    /p_movimiento inválido|p_estado_actual inválido|p_pasos_visuales|p_fecha_desde/i.test(
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
