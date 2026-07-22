import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  adminReportResponseSchema,
  buildAdminReportRpcPayload,
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
  const payload = buildAdminReportRpcPayload(filters);
  const { data, error } = await supabaseBrowser.rpc(
    "admin_report_expedientes_asesores_etapas",
    payload,
  );
  if (error) {
    const msg = error.message ?? "";
    if (/solo super_admin|admin_production/i.test(msg)) {
      throw new AdminReportAsesoresEtapasError(
        "Solo Super Admin puede consultar este reporte.",
      );
    }
    if (/p_estado inválido|p_pasos_visuales/i.test(msg)) {
      throw new AdminReportAsesoresEtapasError(
        "Filtros inválidos. Revisa asesores, etapas y estado.",
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
