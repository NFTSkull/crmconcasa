import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  adminReportResponseSchema,
  buildAdminReportRpcPayload,
  canConsultAdminReport,
  validateAdminReportFechaRango,
  type AdminReportFilters,
  type AdminReportResponse,
} from "./types";

export class AdminReportAsesoresEtapasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminReportAsesoresEtapasError";
  }
}

export async function fetchAdminReportExpedientesAsesoresEtapas(
  filters: AdminReportFilters,
): Promise<AdminReportResponse> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminReportAsesoresEtapasError("Supabase no configurado");
  }

  const fechaCheck = validateAdminReportFechaRango(
    filters.fechaDesde,
    filters.fechaHasta,
  );
  if (!fechaCheck.ok) {
    throw new AdminReportAsesoresEtapasError(fechaCheck.message);
  }

  if (!canConsultAdminReport(filters)) {
    throw new AdminReportAsesoresEtapasError(
      "Selecciona al menos un asesor y una etapa (usa Todos/Todas si aplica).",
    );
  }

  const payload = buildAdminReportRpcPayload(filters);
  const { data, error } = await supabaseBrowser.rpc(
    "admin_report_expedientes_asesores_etapas_v2",
    payload,
  );
  if (error) {
    const msg = error.message ?? "";
    if (/solo super_admin|admin_production/i.test(msg)) {
      throw new AdminReportAsesoresEtapasError(
        "Solo Super Admin puede consultar este reporte.",
      );
    }
    if (/p_estado inválido|p_pasos_visuales|p_fecha_desde/i.test(msg)) {
      throw new AdminReportAsesoresEtapasError(
        "Filtros inválidos. Revisa asesores, etapas, estado y fechas.",
      );
    }
    throw new AdminReportAsesoresEtapasError(
      "No se pudo cargar el reporte de expedientes.",
    );
  }
  const parsed = adminReportResponseSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminReportAsesoresEtapasError(
      "La respuesta del reporte no es válida.",
    );
  }
  return parsed.data;
}

/** Catálogo de asesores (Todos) sin filtros de UI; solo Super Admin. */
export async function fetchAdminReportAsesoresCatalog(): Promise<
  AdminReportResponse
> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminReportAsesoresEtapasError("Supabase no configurado");
  }
  const { data, error } = await supabaseBrowser.rpc(
    "admin_report_expedientes_asesores_etapas_v2",
    {
      p_asesor_ids: null,
      p_pasos_visuales: null,
      p_estado: "vigentes",
      p_fecha_desde: null,
      p_fecha_hasta: null,
    },
  );
  if (error) {
    throw new AdminReportAsesoresEtapasError(
      "No se pudo cargar el catálogo de asesores.",
    );
  }
  const parsed = adminReportResponseSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminReportAsesoresEtapasError(
      "La respuesta del catálogo no es válida.",
    );
  }
  return parsed.data;
}
