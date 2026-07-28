import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  ingresosPageSchema,
  ingresosResumenSchema,
  type IngresosFilters,
  type IngresosPage,
  type IngresosResumen,
} from "./types";

export class AdminIngresosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminIngresosError";
  }
}

function mapRpcError(error: { message?: string }): AdminIngresosError {
  const msg = error.message ?? "";
  if (/solo super_admin|admin_production|admin_ingresos/i.test(msg)) {
    return new AdminIngresosError(
      "Solo Super Admin puede consultar el módulo de ingresos.",
    );
  }
  if (/fecha_desde|p_estado|p_monto_fuente|p_pasos/i.test(msg)) {
    return new AdminIngresosError("Filtros inválidos. Revisa el periodo y los criterios.");
  }
  return new AdminIngresosError("No se pudieron cargar los ingresos.");
}

function rpcArgs(filters: IngresosFilters, page?: number, pageSize?: number) {
  return {
    p_fecha_desde: filters.fechaDesde,
    p_fecha_hasta: filters.fechaHasta,
    p_asesor_ids:
      filters.asesorIds.length > 0 ? [...filters.asesorIds] : null,
    p_monto_fuente:
      filters.montoFuente === "todas" ? null : filters.montoFuente,
    p_porcentajes:
      filters.porcentajes.length > 0 ? [...filters.porcentajes] : null,
    p_pasos_visuales:
      filters.pasosVisuales.length > 0 ? [...filters.pasosVisuales] : null,
    p_estado: filters.estado,
    p_buscar: filters.buscar.trim() || null,
    ...(page != null
      ? { p_page: page, p_page_size: pageSize ?? 25 }
      : {}),
  };
}

export async function fetchIngresosResumen(
  filters: IngresosFilters,
): Promise<IngresosResumen> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminIngresosError("Supabase no configurado");
  }
  const { data, error } = await supabaseBrowser.rpc(
    "super_admin_get_ingresos_resumen",
    rpcArgs(filters),
  );
  if (error) throw mapRpcError(error);
  const parsed = ingresosResumenSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminIngresosError("La respuesta de ingresos no es válida.");
  }
  return parsed.data;
}

export async function fetchIngresosPage(
  filters: IngresosFilters,
  page: number,
  pageSize: number = 25,
): Promise<IngresosPage> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminIngresosError("Supabase no configurado");
  }
  const { data, error } = await supabaseBrowser.rpc(
    "super_admin_list_ingresos_page",
    rpcArgs(filters, page, pageSize),
  );
  if (error) throw mapRpcError(error);
  const parsed = ingresosPageSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminIngresosError("La respuesta del detalle de ingresos no es válida.");
  }
  return parsed.data;
}
