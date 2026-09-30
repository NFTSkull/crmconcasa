import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type AdminPrecalPerformanceSummary = Readonly<{
  totalPrecalificaciones: number;
  nssUnicos: number;
  repeticionesExtra: number;
  nssRepetidosPeriodo: number;
  nssConHistorialRepetido: number;
  aprobadas: number;
  noCumple: number;
  pendientes: number;
  tasaAprobacion: number | null;
  montoPromedioAprobado: number;
  montoTotalAprobado: number;
  topados169k: number;
  topados169kAMesa: number;
  conversionTopadosMesa: number | null;
  expedientesUnicos: number;
  expedientesAMesa: number;
  conversionMesa: number | null;
}>;

export type AdminPrecalPerformanceAdvisor = Readonly<{
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  precalificaciones: number;
  nssUnicos: number;
  repeticionesExtra: number;
  aprobadas: number;
  noCumple: number;
  pendientes: number;
  tasaAprobacion: number | null;
  montoPromedioAprobado: number;
  montoTotalAprobado: number;
  topados169k: number;
  topados169kAMesa: number;
  expedientesUnicos: number;
  expedientesAMesa: number;
  conversionMesa: number | null;
}>;

export type AdminPrecalPerformanceItem = Readonly<{
  eventId: string;
  expedienteId: string;
  eventAt: string;
  tipoEvento: "inicial" | "reprecalificacion";
  nss: string;
  nssPrecalificacionesHistoricas: number;
  clienteNombre: string;
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  programa: string;
  decision: string;
  montoOriginal: number | null;
  montoOperativo: number | null;
  topado169k: boolean;
  submittedToMesa: boolean;
  fechaEnvioMesa: string | null;
  etapaActual: number;
  cicloEstado: string;
  subestado: string;
}>;

export type AdminPrecalPerformanceSegment =
  | "todos"
  | "aprobadas"
  | "no_cumple"
  | "pendientes"
  | "repetidos"
  | "topados"
  | "mesa";

export type AdminPrecalPerformanceResult = Readonly<{
  summary: AdminPrecalPerformanceSummary;
  asesores: readonly AdminPrecalPerformanceAdvisor[];
  items: readonly AdminPrecalPerformanceItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  segmento: AdminPrecalPerformanceSegment;
  amountCapMejoravit: number;
}>;

type FetchInput = Readonly<{
  fromIso: string;
  toExclusiveIso: string;
  asesorId?: string | null;
  search?: string | null;
  segmento?: AdminPrecalPerformanceSegment;
  page?: number;
  pageSize?: number;
}>;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string {
  return String(value ?? "");
}

function strOrNull(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function mapSummary(raw: Record<string, unknown>): AdminPrecalPerformanceSummary {
  return {
    totalPrecalificaciones: num(raw.total_precalificaciones),
    nssUnicos: num(raw.nss_unicos),
    repeticionesExtra: num(raw.repeticiones_extra),
    nssRepetidosPeriodo: num(raw.nss_repetidos_periodo),
    nssConHistorialRepetido: num(raw.nss_con_historial_repetido),
    aprobadas: num(raw.aprobadas),
    noCumple: num(raw.no_cumple),
    pendientes: num(raw.pendientes),
    tasaAprobacion: nullableNum(raw.tasa_aprobacion),
    montoPromedioAprobado: num(raw.monto_promedio_aprobado),
    montoTotalAprobado: num(raw.monto_total_aprobado),
    topados169k: num(raw.topados_169k),
    topados169kAMesa: num(raw.topados_169k_a_mesa),
    conversionTopadosMesa: nullableNum(raw.conversion_topados_mesa),
    expedientesUnicos: num(raw.expedientes_unicos),
    expedientesAMesa: num(raw.expedientes_a_mesa),
    conversionMesa: nullableNum(raw.conversion_mesa),
  };
}

function mapAdvisor(raw: Record<string, unknown>): AdminPrecalPerformanceAdvisor {
  return {
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    precalificaciones: num(raw.precalificaciones),
    nssUnicos: num(raw.nss_unicos),
    repeticionesExtra: num(raw.repeticiones_extra),
    aprobadas: num(raw.aprobadas),
    noCumple: num(raw.no_cumple),
    pendientes: num(raw.pendientes),
    tasaAprobacion: nullableNum(raw.tasa_aprobacion),
    montoPromedioAprobado: num(raw.monto_promedio_aprobado),
    montoTotalAprobado: num(raw.monto_total_aprobado),
    topados169k: num(raw.topados_169k),
    topados169kAMesa: num(raw.topados_169k_a_mesa),
    expedientesUnicos: num(raw.expedientes_unicos),
    expedientesAMesa: num(raw.expedientes_a_mesa),
    conversionMesa: nullableNum(raw.conversion_mesa),
  };
}

function mapItem(raw: Record<string, unknown>): AdminPrecalPerformanceItem {
  return {
    eventId: str(raw.event_id),
    expedienteId: str(raw.expediente_id),
    eventAt: str(raw.event_at),
    tipoEvento:
      raw.tipo_evento === "reprecalificacion" ? "reprecalificacion" : "inicial",
    nss: str(raw.nss),
    nssPrecalificacionesHistoricas: num(raw.nss_precalificaciones_historicas),
    clienteNombre: str(raw.cliente_nombre),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    programa: str(raw.programa),
    decision: str(raw.decision),
    montoOriginal: nullableNum(raw.monto_original),
    montoOperativo: nullableNum(raw.monto_operativo),
    topado169k: raw.topado_169k === true,
    submittedToMesa: raw.submitted_to_mesa === true,
    fechaEnvioMesa: strOrNull(raw.fecha_envio_mesa),
    etapaActual: num(raw.etapa_actual),
    cicloEstado: str(raw.ciclo_estado),
    subestado: str(raw.subestado),
  };
}

export async function fetchAdminPrecalPerformance(
  input: FetchInput,
): Promise<AdminPrecalPerformanceResult> {
  if (!supabaseBrowser) throw new Error("Supabase no disponible");

  const { data, error } = await supabaseBrowser.rpc("admin_precal_performance", {
    p_from: input.fromIso,
    p_to_exclusive: input.toExclusiveIso,
    p_asesor_id: input.asesorId || null,
    p_search: input.search?.trim() || null,
    p_segmento: input.segmento ?? "todos",
    p_page: input.page ?? 1,
    p_page_size: input.pageSize ?? 50,
  });

  if (error) {
    throw new Error(error.message || "No se pudo cargar el panel de precalificaciones");
  }

  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  const summaryRaw =
    row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
      ? (row.summary as Record<string, unknown>)
      : {};

  return {
    summary: mapSummary(summaryRaw),
    asesores: (Array.isArray(row.asesores) ? row.asesores : []).map((x) =>
      mapAdvisor(x as Record<string, unknown>),
    ),
    items: (Array.isArray(row.items) ? row.items : []).map((x) =>
      mapItem(x as Record<string, unknown>),
    ),
    totalCount: num(row.total_count),
    page: Math.max(1, num(row.page) || 1),
    pageSize: Math.max(1, num(row.page_size) || 50),
    segmento: (str(row.segmento) || "todos") as AdminPrecalPerformanceSegment,
    amountCapMejoravit: num(row.amount_cap_mejoravit) || 169000,
  };
}
