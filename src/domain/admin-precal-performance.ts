import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export type AdminPrecalPerformanceDetailFilter =
  | "todos"
  | "compartidos"
  | "reprecalificaciones"
  | "topados"
  | "mesa"
  | "no_mesa";

export type AdminPrecalPerformanceSummary = Readonly<{
  totalPrecalificaciones: number;
  nssUnicos: number;
  nssCompartidos: number;
  reprecalificaciones: number;
  aprobadas: number;
  noCumple: number;
  pendientes: number;
  resueltas: number;
  tasaAprobacionPct: number;
  montoPromedio: number;
  montoTotalAdmin: number;
  expedientesGenerados: number;
  expedientesEnMesa: number;
  conversionMesaPct: number;
  topadosNss: number;
  topadosNssEnMesa: number;
  topadosConversionPct: number;
}>;

export type AdminPrecalPerformanceAdvisor = Readonly<{
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  totalPrecalificaciones: number;
  nssUnicos: number;
  nssCompartidos: number;
  reprecalificaciones: number;
  expedientesGenerados: number;
  expedientesEnMesa: number;
  aprobadas: number;
  noCumple: number;
  pendientes: number;
  tasaAprobacionPct: number;
  montoPromedio: number;
  topadosNss: number;
  topadosNssEnMesa: number;
  conversionMesaPct: number;
}>;

export type AdminPrecalPerformanceItem = Readonly<{
  attemptKey: string;
  intentoId: string | null;
  expedienteId: string;
  fecha: string;
  nss: string;
  nssPrecalHistoricas: number;
  clienteNombre: string;
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  precalificadorOrigenId: string | null;
  precalificadorNombre: string | null;
  precalificadorEmail: string | null;
  programa: string;
  decision: string;
  montoAprobado: number | null;
  topado169k: boolean;
  submittedToMesa: boolean;
  fechaEnvioMesa: string | null;
  etapaActual: number;
  cicloEstado: string;
  subestado: string;
}>;

export type AdminPrecalPerformanceResult = Readonly<{
  summary: AdminPrecalPerformanceSummary;
  asesores: readonly AdminPrecalPerformanceAdvisor[];
  items: readonly AdminPrecalPerformanceItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  detailFilter: AdminPrecalPerformanceDetailFilter;
  generatedAt: string | null;
}>;

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  const valueString = str(value).trim();
  return valueString || null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function mapSummary(raw: Record<string, unknown>): AdminPrecalPerformanceSummary {
  return {
    totalPrecalificaciones: num(raw.total_precalificaciones),
    nssUnicos: num(raw.nss_unicos),
    nssRepetidos: num(raw.nss_repetidos),
    repeticionesExtraPeriodo: num(raw.repeticiones_extra_periodo),
    aprobadas: num(raw.aprobadas),
    noCumple: num(raw.no_cumple),
    pendientes: num(raw.pendientes),
    resueltas: num(raw.resueltas),
    tasaAprobacionPct: num(raw.tasa_aprobacion_pct),
    montoPromedio: num(raw.monto_promedio),
    montoTotalAdmin: num(raw.monto_total_admin),
    expedientesGenerados: num(raw.expedientes_generados),
    expedientesEnMesa: num(raw.expedientes_en_mesa),
    conversionMesaPct: num(raw.conversion_mesa_pct),
    topadosNss: num(raw.topados_nss),
    topadosNssEnMesa: num(raw.topados_nss_en_mesa),
    topadosConversionPct: num(raw.topados_conversion_pct),
  };
}

function mapAdvisor(raw: Record<string, unknown>): AdminPrecalPerformanceAdvisor {
  return {
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    totalPrecalificaciones: num(raw.total_precalificaciones),
    nssUnicos: num(raw.nss_unicos),
    nssRepetidos: num(raw.nss_repetidos),
    expedientesGenerados: num(raw.expedientes_generados),
    expedientesEnMesa: num(raw.expedientes_en_mesa),
    aprobadas: num(raw.aprobadas),
    noCumple: num(raw.no_cumple),
    pendientes: num(raw.pendientes),
    tasaAprobacionPct: num(raw.tasa_aprobacion_pct),
    montoPromedio: num(raw.monto_promedio),
    topadosNss: num(raw.topados_nss),
    topadosNssEnMesa: num(raw.topados_nss_en_mesa),
    conversionMesaPct: num(raw.conversion_mesa_pct),
  };
}

function mapItem(raw: Record<string, unknown>): AdminPrecalPerformanceItem {
  return {
    attemptKey: str(raw.attempt_key),
    intentoId: strOrNull(raw.intento_id),
    expedienteId: str(raw.expediente_id),
    fecha: str(raw.fecha),
    nss: str(raw.nss),
    nssPrecalHistoricas: num(raw.nss_precal_historicas),
    clienteNombre: str(raw.cliente_nombre),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    precalificadorOrigenId: strOrNull(raw.precalificador_origen_id),
    precalificadorNombre: strOrNull(raw.precalificador_nombre),
    precalificadorEmail: strOrNull(raw.precalificador_email),
    programa: str(raw.programa),
    decision: str(raw.decision),
    montoAprobado:
      raw.monto_aprobado == null ? null : num(raw.monto_aprobado),
    topado169k: bool(raw.topado_169k),
    submittedToMesa: bool(raw.submitted_to_mesa),
    fechaEnvioMesa: strOrNull(raw.fecha_envio_mesa),
    etapaActual: num(raw.etapa_actual),
    cicloEstado: str(raw.ciclo_estado),
    subestado: str(raw.subestado),
  };
}

export async function fetchAdminPrecalPerformance(input: {
  fromIso: string;
  toExclusiveIso: string;
  asesorId?: string | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
  detailFilter?: AdminPrecalPerformanceDetailFilter;
}): Promise<AdminPrecalPerformanceResult> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new Error("Supabase no configurado");
  }

  const { data, error } = await supabaseBrowser.rpc("admin_precal_performance", {
    p_from: input.fromIso,
    p_to_exclusive: input.toExclusiveIso,
    p_asesor_id: input.asesorId || null,
    p_search: input.search?.trim() || null,
    p_page: input.page ?? 1,
    p_page_size: input.pageSize ?? 50,
    p_detail_filter: input.detailFilter ?? "todos",
  });

  if (error) {
    throw new Error(error.message || "No se pudo cargar rendimiento de precalificaciones");
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const summaryRaw =
    payload.summary && typeof payload.summary === "object"
      ? (payload.summary as Record<string, unknown>)
      : {};
  const advisorRows = Array.isArray(payload.asesores) ? payload.asesores : [];
  const itemRows = Array.isArray(payload.items) ? payload.items : [];

  return {
    summary: mapSummary(summaryRaw),
    asesores: advisorRows.map((row) => mapAdvisor(row as Record<string, unknown>)),
    items: itemRows.map((row) => mapItem(row as Record<string, unknown>)),
    totalCount: num(payload.total_count),
    page: Math.max(1, num(payload.page) || 1),
    pageSize: Math.max(1, num(payload.page_size) || 50),
    detailFilter: (str(payload.detail_filter) || "todos") as AdminPrecalPerformanceDetailFilter,
    generatedAt: strOrNull(payload.generated_at),
  };
}
