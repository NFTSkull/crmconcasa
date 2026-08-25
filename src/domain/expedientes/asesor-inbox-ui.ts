/**
 * B1 UI — helpers para cablear `/asesor` a RPCs B1.5 (sin fallback a listForAsesor).
 */
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";
import type {
  AsesorPrecalificacionExportSource,
} from "@/lib/exportAsesorPrecalificacionesExcel";
import {
  ASESOR_INBOX_DEFAULT_PAGE_SIZE,
  ASESOR_INBOX_MAX_PAGE_SIZE,
  type AsesorInboxQuickFilter,
  type AsesorInboxSummaryResult,
  type AsesorListExpedienteItem,
  type AsesorListExpedientesPageInput,
  type AsesorListExpedientesPageResult,
  asesorInboxQuickFilterSchema,
  asesorInboxResultadoRealSchema,
} from "./asesor-inbox-rpc";
import { mapProgramaDbToUi } from "./map-programa";
import { normalizePagoConcasaResultado } from "./pago-concasa-resultado";
import {
  deriveResultadoRealExpediente,
  type ExpedienteMock,
  type ResultadoRealExpediente,
} from "./mock.repo";
import { asesorExpedienteDetalleHref } from "./asesor-expediente-correccion-ui";

export const ASESOR_INBOX_UI_PAGE_SIZE = ASESOR_INBOX_DEFAULT_PAGE_SIZE;
export const ASESOR_INBOX_DEPENDENT_IDS_MAX = ASESOR_INBOX_DEFAULT_PAGE_SIZE;
export const ASESOR_INBOX_BUSCAR_DEBOUNCE_MS = 350;

export type AsesorInboxUiFilters = Readonly<{
  buscar: string;
  decision: string;
  estatusOperativo: string;
  resultadoReal: string;
  programa: string;
  etapaExacta: string;
  fechaDesde: string;
  fechaHasta: string;
}>;

export type AsesorInboxPageViewModel = Readonly<{
  items: ExpedienteMock[];
  /** Categoría de corrección ya calculada en SQL (por id). */
  categoriaPorId: Readonly<Record<string, string>>;
  /** P197: estado efectivo de cola (por id). */
  estadoEfectivoPorId: Readonly<Record<string, string>>;
  /** P209: explicación causal de corrección (por id). */
  correccionExplicacionPorId: Readonly<Record<string, string>>;
  /** P183: metadata de re-precal REAL (ortogonal a resultado_real). */
  reprecalPorId: Readonly<Record<string, AsesorInboxReprecalMeta>>;
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}>;

export type AsesorInboxReprecalEstado = "pending" | "approved" | "no_cumple";

export type AsesorInboxReprecalMeta = Readonly<{
  estado: AsesorInboxReprecalEstado;
  solicitadaAt: string | null;
  resueltaAt: string | null;
  activityAt: string | null;
  montoPrevio: number | null;
  montoResultado: number | null;
  programaSolicitado: string | null;
}>;

export type AsesorInboxKpisFromSummary = Readonly<{
  total: number;
  aprobadosEditor: number;
  noCumple: number;
  enTramite: number;
  rechazadosMesa: number;
  cancelados: number;
  correccionRequerida: number;
  correccionEnviada: number;
  agendarBiometricos: number;
  agendarFirma: number;
  subirAcuse: number;
}>;

function emptyToNull(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t ? t : null;
}

function parseEtapaExacta(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseResultadoReal(
  raw: string,
): AsesorListExpedientesPageInput["resultado_real"] {
  const t = raw.trim();
  if (!t) return null;
  const parsed = asesorInboxResultadoRealSchema.safeParse(t);
  return parsed.success ? parsed.data : null;
}

export function buildAsesorInboxListInput(params: {
  page: number;
  pageSize?: number;
  filters: AsesorInboxUiFilters;
  quickFilter: AsesorInboxQuickFilter | string;
}): AsesorListExpedientesPageInput {
  const quickParsed = asesorInboxQuickFilterSchema.safeParse(params.quickFilter);
  return {
    page: Math.max(1, Math.floor(params.page) || 1),
    page_size: Math.min(
      ASESOR_INBOX_MAX_PAGE_SIZE,
      Math.max(1, Math.floor(params.pageSize ?? ASESOR_INBOX_UI_PAGE_SIZE) || 1),
    ),
    buscar: emptyToNull(params.filters.buscar),
    decision: emptyToNull(params.filters.decision),
    estatus_operativo: emptyToNull(params.filters.estatusOperativo),
    resultado_real: parseResultadoReal(params.filters.resultadoReal),
    programa: emptyToNull(params.filters.programa),
    etapa_exacta: parseEtapaExacta(params.filters.etapaExacta),
    fecha_desde: emptyToNull(params.filters.fechaDesde),
    fecha_hasta: emptyToNull(params.filters.fechaHasta),
    quick_filter: quickParsed.success ? quickParsed.data : "todos",
  };
}

/** Página 1..N; si page > totalPages regresa la última válida. */
export function clampAsesorInboxPage(
  page: number,
  totalCount: number,
  pageSize: number = ASESOR_INBOX_UI_PAGE_SIZE,
): number {
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalCount) / size));
  const raw = Math.max(1, Math.floor(page) || 1);
  return Math.min(raw, totalPages);
}

export function asesorInboxTotalPages(
  totalCount: number,
  pageSize: number = ASESOR_INBOX_UI_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(Math.max(0, totalCount) / Math.max(1, pageSize)));
}

/** Texto “Mostrando X–Y de Z” (Z=0 → vacío). */
export function formatAsesorInboxShowingRange(
  page: number,
  pageSize: number,
  totalCount: number,
): string {
  if (totalCount <= 0) return "Mostrando 0 de 0";
  const safe = clampAsesorInboxPage(page, totalCount, pageSize);
  const from = (safe - 1) * pageSize + 1;
  const to = Math.min(safe * pageSize, totalCount);
  return `Mostrando ${from}–${to} de ${totalCount}`;
}

export function capIdsForDependentLoads(
  ids: readonly string[],
  max: number = ASESOR_INBOX_DEPENDENT_IDS_MAX,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function parseMonto(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

export function mapAsesorInboxReprecalMeta(
  item: AsesorListExpedienteItem,
): AsesorInboxReprecalMeta | null {
  const estado = item.reprecal_estado;
  if (estado !== "pending" && estado !== "approved" && estado !== "no_cumple") {
    return null;
  }
  return {
    estado,
    solicitadaAt: item.reprecal_solicitada_at ?? null,
    resueltaAt: item.reprecal_resuelta_at ?? null,
    activityAt: item.reprecal_activity_at ?? null,
    montoPrevio: parseMonto(item.reprecal_monto_previo),
    montoResultado: parseMonto(item.reprecal_monto_resultado),
    programaSolicitado: item.reprecal_programa_solicitado ?? null,
  };
}

export function asesorInboxReprecalBadgeLabel(
  estado: AsesorInboxReprecalEstado,
): string {
  if (estado === "pending") return "Precalificación actualizada · En revisión";
  if (estado === "approved") return "Monto actualizado";
  return "Resultado actualizado · No cumple";
}

export function asesorInboxReprecalBadgeClass(
  estado: AsesorInboxReprecalEstado,
): string {
  if (estado === "pending") {
    return "inline-flex w-fit rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-900";
  }
  if (estado === "approved") {
    return "inline-flex w-fit rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800";
  }
  return "inline-flex w-fit rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-800";
}

function compactInboxDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${h}:${min}`;
}

export function formatAsesorInboxActualizacion(
  reprecal: AsesorInboxReprecalMeta | null | undefined,
  updatedAt: string | null | undefined,
  formatFallback: (iso: string) => string,
): string {
  const activity = reprecal?.activityAt?.trim();
  if (reprecal && activity) {
    const when = compactInboxDateTime(activity);
    if (reprecal.estado === "pending") return `Reenviada ${when}`;
    return `Resultado ${when}`;
  }
  if (updatedAt?.trim()) return formatFallback(updatedAt);
  return "—";
}

export function formatAsesorInboxResueltaHint(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} · ${h}:${min}`;
}

export function formatAsesorInboxMontoAntes(
  montoPrevio: number | null | undefined,
  montoVigente: number | null | undefined,
): string | null {
  if (
    montoPrevio == null ||
    montoVigente == null ||
    !Number.isFinite(montoPrevio) ||
    !Number.isFinite(montoVigente) ||
    montoPrevio === montoVigente
  ) {
    return null;
  }
  return `Antes $${Math.round(montoPrevio).toLocaleString("es-MX")}`;
}

function normalizeResultadoReal(raw: string): ResultadoRealExpediente {
  const parsed = asesorInboxResultadoRealSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return "pendiente_editor";
}

/** Mapea ítem RPC → ExpedienteMock (sin embed de asesor; email opcional del actor). */
export function mapAsesorInboxListItemToExpedienteMock(
  item: AsesorListExpedienteItem,
  opts?: { asesorEmail?: string | null; asesorNombre?: string | null },
): ExpedienteMock {
  const programaUi =
    (item.programa ?? "").trim() ||
    mapProgramaDbToUi(item.programa_db ?? "");
  const decisionRaw = (item.decision ?? "pendiente").trim() || "pendiente";
  const decision =
    decisionRaw === "aprobado" || decisionRaw === "no_cumple" || decisionRaw === "pendiente"
      ? decisionRaw
      : "pendiente";

  const mock: ExpedienteMock = {
    id: item.id,
    base: {
      programa: programaUi,
      nss: item.nss ?? "",
      cliente_nombre: item.cliente_nombre ?? "",
      telefono_cliente: item.telefono_cliente ?? "",
      direccion_opcional: (item.direccion_opcional ?? "").trim(),
      asesorId: opts?.asesorEmail?.trim() || item.asesor_id,
      asesorNombre: opts?.asesorNombre ?? null,
      asesorEmail: opts?.asesorEmail ?? null,
      createdAt: item.created_at,
      origenMesa:
        item.origen_mesa === "interno" || item.origen_mesa === "externo"
          ? item.origen_mesa
          : item.submitted_to_mesa
            ? "interno"
            : null,
    },
    editorDecision: {
      decision,
      monto_aprobado: parseMonto(item.monto_aprobado),
      notas_revision: item.notas_revision ?? "",
      aprobadoAt: item.aprobado_at ?? null,
      montoAprobadoAlAprobar: parseMonto(item.monto_aprobado_al_aprobar),
      noCumpleAt: item.no_cumple_at ?? null,
    },
    operativo: {
      etapaActual:
        typeof item.etapa_actual === "number" ? item.etapa_actual : null,
      subestado: (item.subestado as ExpedienteMock["operativo"]["subestado"]) ?? "pendiente",
      motivoRechazo: item.motivo_rechazo ?? null,
      comentarioRechazo: item.comentario_rechazo ?? null,
      fechaCita: item.fecha_cita ?? null,
      updatedAt: item.updated_at ?? null,
      submittedToMesa: Boolean(item.submitted_to_mesa),
      fechaEnvioMesa: item.fecha_envio_mesa ?? null,
      cicloEstado: item.ciclo_estado ?? null,
      firmaAgendableDesde: item.firma_agendable_desde?.slice(0, 10) ?? null,
      pagoConcasaResultado: normalizePagoConcasaResultado(item.pago_concasa_resultado),
      pagoConcasaAt: item.pago_concasa_at ?? null,
    },
    reingreso: {
      expedienteAnteriorId: item.expediente_anterior_id ?? null,
      rechazoId: item.reingreso_rechazo_id ?? null,
      rechazoEtapa: null,
      rechazoMotivo: null,
      rechazoComentario: null,
      biometricosCondicion: null,
      biometricosRazon: null,
    },
    reingresoManual: {
      count: item.reingreso_manual_count ?? 0,
      at: item.reingreso_manual_at ?? null,
      by: item.reingreso_manual_by ?? null,
    },
    reprecalificacionPendienteId: item.reprecalificacion_pendiente_id ?? null,
  };

  // Preferir resultado_real del SQL; fallback derive local.
  void normalizeResultadoReal(item.resultado_real);
  void deriveResultadoRealExpediente(mock);
  return mock;
}

export function mapAsesorInboxPageResultToViewModel(
  result: AsesorListExpedientesPageResult,
  opts?: { asesorEmail?: string | null },
): AsesorInboxPageViewModel {
  const categoriaPorId: Record<string, string> = {};
  const estadoEfectivoPorId: Record<string, string> = {};
  const correccionExplicacionPorId: Record<string, string> = {};
  const reprecalPorId: Record<string, AsesorInboxReprecalMeta> = {};
  const items = result.items.map((row) => {
    categoriaPorId[row.id] = row.categoria_correccion;
    if (row.estado_efectivo) estadoEfectivoPorId[row.id] = row.estado_efectivo;
    const explicacion = (row.correccion_explicacion ?? "").trim();
    if (explicacion) correccionExplicacionPorId[row.id] = explicacion;
    const meta = mapAsesorInboxReprecalMeta(row);
    if (meta) reprecalPorId[row.id] = meta;
    return mapAsesorInboxListItemToExpedienteMock(row, {
      asesorEmail: opts?.asesorEmail,
    });
  });
  return {
    items,
    categoriaPorId,
    estadoEfectivoPorId,
    correccionExplicacionPorId,
    reprecalPorId,
    totalCount: result.total_count,
    page: result.page,
    pageSize: result.page_size,
    hasMore: result.has_more,
  };
}

export function mapAsesorInboxSummaryToKpis(
  summary: AsesorInboxSummaryResult,
): AsesorInboxKpisFromSummary {
  const c = summary.counts;
  return {
    total: c.total,
    aprobadosEditor: c.aprobados_editor,
    noCumple: c.no_cumple,
    enTramite: c.en_tramite,
    rechazadosMesa: c.rechazados_mesa,
    cancelados: c.cancelados,
    correccionRequerida: c.correccion_requerida,
    correccionEnviada: c.correccion_enviada,
    agendarBiometricos: c.agendar_biometricos,
    agendarFirma: c.agendar_firma,
    subirAcuse: c.subir_acuse,
  };
}

const NOTIF_KINDS = new Set([
  "correccion_requerida",
  "rechazado_mesa",
  "cancelado",
  "correccion_enviada",
  "nuevo_por_revisar",
  "pendiente_revision",
  "enviado_mesa",
  "cita_hoy",
  "cita_cambio",
  "cita_programada",
  "extraordinary_rebook_required",
  "inscripcion_rebook_required",
]);

export function mapAsesorInboxNotificationsToDashboard(
  summary: AsesorInboxSummaryResult,
): DashboardNotificationItem[] {
  return summary.notifications.map((n) => {
    const kind = NOTIF_KINDS.has(n.kind)
      ? (n.kind as DashboardNotificationItem["kind"])
      : "pendiente_revision";
    const tipoLabel =
      kind === "correccion_requerida" && n.tipo_label === "Corrección requerida"
        ? "Necesita corrección"
        : n.tipo_label;
    return {
      id: n.id,
      expedienteId: n.expediente_id,
      clienteNombre: n.cliente_nombre || "—",
      kind,
      tipoLabel,
      mensaje: n.mensaje,
      fecha: n.fecha ?? null,
      prioridad: n.prioridad,
      href: asesorExpedienteDetalleHref(
        n.expediente_id,
        kind === "correccion_requerida" ? "correccion_requerida" : undefined,
      ),
    };
  });
}

export function mapExpedienteMockToExportSource(
  exp: ExpedienteMock,
): AsesorPrecalificacionExportSource {
  return {
    id: exp.id,
    asesorId: exp.base.asesorId,
    cliente_nombre: exp.base.cliente_nombre,
    nss: exp.base.nss,
    telefono_cliente: exp.base.telefono_cliente,
    programa: exp.base.programa,
    monto_aprobado: exp.editorDecision.monto_aprobado,
  };
}

/**
 * Recorre páginas RPC (page_size máx) para export on-demand.
 * Dedup por id. No usa listForAsesor.
 */
export async function collectAsesorInboxExportRows(params: {
  listPage: (
    input: AsesorListExpedientesPageInput,
  ) => Promise<AsesorListExpedientesPageResult>;
  /** Filtros del inbox al exportar; por defecto universo completo del asesor. */
  baseInput?: Partial<AsesorListExpedientesPageInput>;
  pageSize?: number;
  onProgress?: (loaded: number, total: number) => void;
  asesorEmail?: string | null;
}): Promise<AsesorPrecalificacionExportSource[]> {
  const pageSize = Math.min(
    ASESOR_INBOX_MAX_PAGE_SIZE,
    Math.max(1, params.pageSize ?? ASESOR_INBOX_MAX_PAGE_SIZE),
  );
  const collected: AsesorPrecalificacionExportSource[] = [];
  const seen = new Set<string>();
  let page = 1;
  let total = 0;
  let hasMore = true;
  let guard = 0;

  while (hasMore && guard < 10_000) {
    guard += 1;
    const result = await params.listPage({
      page,
      page_size: pageSize,
      buscar: params.baseInput?.buscar ?? null,
      decision: params.baseInput?.decision ?? null,
      estatus_operativo: params.baseInput?.estatus_operativo ?? null,
      resultado_real: params.baseInput?.resultado_real ?? null,
      programa: params.baseInput?.programa ?? null,
      etapa_exacta: params.baseInput?.etapa_exacta ?? null,
      fecha_desde: params.baseInput?.fecha_desde ?? null,
      fecha_hasta: params.baseInput?.fecha_hasta ?? null,
      quick_filter: params.baseInput?.quick_filter ?? "todos",
    });
    total = result.total_count;
    for (const row of result.items) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const mock = mapAsesorInboxListItemToExpedienteMock(row, {
        asesorEmail: params.asesorEmail,
      });
      collected.push(mapExpedienteMockToExportSource(mock));
    }
    params.onProgress?.(collected.length, total);
    hasMore = result.has_more && result.items.length > 0;
    page += 1;
    if (!result.has_more) break;
  }

  return collected;
}

export function resultadoRealFromInboxItem(
  item: AsesorListExpedienteItem,
  mock: ExpedienteMock,
): ResultadoRealExpediente {
  const fromRpc = normalizeResultadoReal(item.resultado_real);
  if (fromRpc) return fromRpc;
  return deriveResultadoRealExpediente(mock);
}
