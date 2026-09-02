import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { INGRESOS_EXPORT_MAX_ROWS } from "./export-config";
import {
  ingresosDetalleItemSchema,
  ingresosPageSchema,
  ingresosResumenSchema,
  type IngresosDetalleItem,
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

const ingresosExportSchema = z.object({
  total: z.coerce.number().int(),
  limit: z.coerce.number().int(),
  timezone: z.string().optional(),
  generated_at: z.string().optional(),
  actor_nombre: z.string().nullable().optional(),
  organization_nombre: z.string().nullable().optional(),
  organization_id: z.string().uuid().optional(),
  items: z.array(ingresosDetalleItemSchema).default([]),
});

export type IngresosExportPayload = z.infer<typeof ingresosExportSchema>;

async function requireAdminIngresosSession(): Promise<void> {
  if (!supabaseBrowser) {
    throw new AdminIngresosError("Supabase no configurado");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();

  if (sessionError || !session?.user) {
    throw new AdminIngresosError(
      "Tu sesión de Super Admin expiró. Inicia sesión de nuevo.",
    );
  }
}

function mapRpcError(error: { message?: string; code?: string }): AdminIngresosError {
  const msg = error.message ?? "";
  if (/solo super_admin|admin_production|admin_ingresos/i.test(msg)) {
    return new AdminIngresosError(
      "Solo Super Admin puede consultar el módulo de ingresos.",
    );
  }
  if (error.code === "42501" || /permission denied for function/i.test(msg)) {
    return new AdminIngresosError(
      "Tu sesión no tiene autorización para este reporte. Recarga la página o inicia sesión de nuevo.",
    );
  }
  if (/export_limit_exceeded/i.test(msg)) {
    return new AdminIngresosError(
      "El reporte supera el límite permitido. Reduce el periodo o los filtros.",
    );
  }
  if (/JWT|session|auth|not authenticated|expir/i.test(msg)) {
    return new AdminIngresosError(
      "Tu sesión expiró. Vuelve a iniciar sesión e intenta de nuevo.",
    );
  }
  if (/fecha_desde|p_estado|p_monto_fuente|p_stage_scope|p_visible_step|p_pasos/i.test(msg)) {
    return new AdminIngresosError("Filtros inválidos. Revisa el periodo y los criterios.");
  }
  return new AdminIngresosError("No se pudieron cargar los ingresos.");
}

function rpcArgs(filters: IngresosFilters, page?: number, pageSize?: number) {
  const needsStep =
    filters.stageScope === "from_step" || filters.stageScope === "exact_step";
  return {
    p_fecha_desde: filters.fechaDesde,
    p_fecha_hasta: filters.fechaHasta,
    p_asesor_ids:
      filters.asesorIds.length > 0 ? [...filters.asesorIds] : null,
    p_monto_fuente:
      filters.montoFuente === "todas" ? null : filters.montoFuente,
    p_porcentajes:
      filters.porcentajes.length > 0 ? [...filters.porcentajes] : null,
    p_stage_scope: filters.stageScope,
    p_visible_step: needsStep ? filters.visibleStep : null,
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
  await requireAdminIngresosSession();
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
  await requireAdminIngresosSession();
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

export async function fetchIngresosExport(
  filters: IngresosFilters,
  limit: number = INGRESOS_EXPORT_MAX_ROWS,
): Promise<IngresosExportPayload> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AdminIngresosError("Supabase no configurado");
  }
  await requireAdminIngresosSession();
  const { data, error } = await supabaseBrowser.rpc(
    "super_admin_export_ingresos",
    {
      ...rpcArgs(filters),
      p_limit: Math.min(Math.max(limit, 1), INGRESOS_EXPORT_MAX_ROWS),
    },
  );
  if (error) {
    if (/export_limit_exceeded/i.test(error.message ?? "")) {
      throw new AdminIngresosError(
        "El reporte supera el límite permitido. Reduce el periodo o los filtros.",
      );
    }
    throw mapRpcError(error);
  }
  const parsed = ingresosExportSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AdminIngresosError("No se pudo generar el Excel. Intenta nuevamente.");
  }
  return parsed.data;
}

export type IngresosExportBundle = Readonly<{
  resumen: IngresosResumen;
  items: readonly IngresosDetalleItem[];
  exportMeta: Pick<
    IngresosExportPayload,
    "actor_nombre" | "organization_nombre" | "timezone" | "generated_at" | "total"
  >;
}>;

/** Snapshot de filtros: resumen + detalle completo en paralelo (misma consulta lógica). */
export async function fetchIngresosExportBundle(
  filters: IngresosFilters,
): Promise<IngresosExportBundle> {
  const [resumen, exported] = await Promise.all([
    fetchIngresosResumen(filters),
    fetchIngresosExport(filters),
  ]);
  if (exported.total === 0 || exported.items.length === 0) {
    throw new AdminIngresosError(
      "No hay expedientes que coincidan con los filtros seleccionados.",
    );
  }
  return {
    resumen,
    items: exported.items,
    exportMeta: {
      actor_nombre: exported.actor_nombre,
      organization_nombre: exported.organization_nombre,
      timezone: exported.timezone,
      generated_at: exported.generated_at,
      total: exported.total,
    },
  };
}
