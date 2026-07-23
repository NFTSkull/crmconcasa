import { z } from "zod";
import {
  ETAPAS_VISUALES_OPERATIVAS,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
  etapasInternasParaPasoVisual,
} from "@/domain/expedientes/asesor-seguimiento-operativo";

export const ADMIN_REPORT_ESTADOS = ["vigentes", "activos", "rechazados"] as const;
export type AdminReportEstado = (typeof ADMIN_REPORT_ESTADOS)[number];

export const ADMIN_REPORT_TIPOS_FECHA = [
  "envio_mesa",
  "entrada_paso_actual",
] as const;
export type AdminReportTipoFecha = (typeof ADMIN_REPORT_TIPOS_FECHA)[number];

export const adminReportEstadoSchema = z.enum(ADMIN_REPORT_ESTADOS);
export const adminReportTipoFechaSchema = z.enum(ADMIN_REPORT_TIPOS_FECHA);

export const ADMIN_REPORT_TIPO_FECHA_OPTIONS: ReadonlyArray<{
  value: AdminReportTipoFecha;
  label: string;
}> = [
  { value: "envio_mesa", label: "Fecha de envío a Mesa" },
  {
    value: "entrada_paso_actual",
    label: "Fecha de entrada al paso actual",
  },
];

export const DEFAULT_ADMIN_REPORT_TIPO_FECHA: AdminReportTipoFecha = "envio_mesa";

export const adminReportResumenRowSchema = z.object({
  asesor_id: z.string().uuid(),
  asesor_nombre: z.string(),
  asesor_email: z.string().nullable().optional(),
  paso_visual: z.number().int().min(1).max(11),
  paso_nombre: z.string(),
  activos: z.number().int().nonnegative(),
  rechazados: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const adminReportDetalleRowSchema = z.object({
  asesor_id: z.string().uuid(),
  asesor_nombre: z.string(),
  asesor_email: z.string().nullable().optional(),
  cliente_nombre: z.string(),
  nss: z.string(),
  etapa_actual: z.number().int().min(1).max(12),
  paso_visual: z.number().int().min(1).max(11),
  paso_nombre: z.string(),
  estado: z.enum(["activo", "rechazado"]),
  fecha_entrada_paso_actual: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  fecha_envio_mesa: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const adminReportMetaSchema = z.object({
  asesores: z.number().int().nonnegative(),
  pasos: z.number().int().nonnegative(),
  activos: z.number().int().nonnegative(),
  rechazados: z.number().int().nonnegative(),
  expedientes: z.number().int().nonnegative(),
  tipo_fecha: adminReportTipoFechaSchema.optional(),
  sin_fecha_canonica: z.number().int().nonnegative().optional(),
  excluidos_por_fecha_desconocida: z.number().int().nonnegative().optional(),
});

export const adminReportResponseSchema = z.object({
  resumen: z.array(adminReportResumenRowSchema),
  detalle: z.array(adminReportDetalleRowSchema),
  meta: adminReportMetaSchema,
});

export type AdminReportResumenRow = z.infer<typeof adminReportResumenRowSchema>;
export type AdminReportDetalleRow = z.infer<typeof adminReportDetalleRowSchema>;
export type AdminReportMeta = z.infer<typeof adminReportMetaSchema>;
export type AdminReportResponse = z.infer<typeof adminReportResponseSchema>;

export type AdminReportFilters = Readonly<{
  asesorIds: readonly string[];
  pasosVisuales: readonly number[];
  estado: AdminReportEstado;
  tipoFecha: AdminReportTipoFecha;
  fechaDesde: string | null;
  fechaHasta: string | null;
}>;

export const ADMIN_REPORT_PASO_OPTIONS = ETAPAS_VISUALES_OPERATIVAS.map((e) => ({
  value: e.pasoVisual,
  label: `Paso ${e.pasoVisual} · ${e.nombre}`,
}));

export const ADMIN_REPORT_ALL_PASO_VALUES: readonly number[] =
  ETAPAS_VISUALES_OPERATIVAS.map((e) => e.pasoVisual);

export function expandPasosVisualesToEtapasInternas(
  pasos: readonly number[],
): number[] {
  const set = new Set<number>();
  for (const paso of pasos) {
    for (const etapa of etapasInternasParaPasoVisual(paso)) {
      set.add(etapa);
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function validateAdminReportPasos(
  pasos: readonly number[],
): { ok: true } | { ok: false; message: string } {
  if (
    pasos.some(
      (p) => !Number.isInteger(p) || p < 1 || p > TOTAL_PASOS_VISUALES_OPERATIVOS,
    )
  ) {
    return { ok: false, message: "Los pasos deben estar entre 1 y 11." };
  }
  return { ok: true };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAdminReportFechaRango(
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

/** Tras limpiar: no se consulta con arreglos vacíos (vacío ≠ Todos). */
export function canConsultAdminReport(filters: AdminReportFilters): boolean {
  return filters.asesorIds.length > 0 && filters.pasosVisuales.length > 0;
}

export function buildAdminReportRpcPayload(filters: AdminReportFilters): Readonly<{
  p_asesor_ids: string[];
  p_pasos_visuales: number[];
  p_estado: AdminReportEstado;
  p_tipo_fecha: AdminReportTipoFecha;
  p_fecha_desde: string | null;
  p_fecha_hasta: string | null;
}> {
  return {
    p_asesor_ids: [...filters.asesorIds],
    p_pasos_visuales: [...filters.pasosVisuales],
    p_estado: filters.estado,
    p_tipo_fecha: filters.tipoFecha,
    p_fecha_desde: filters.fechaDesde?.trim() || null,
    p_fecha_hasta: filters.fechaHasta?.trim() || null,
  };
}

export type AdminReportTableGroup = Readonly<{
  asesorId: string;
  asesorNombre: string;
  asesorEmail: string | null;
  rows: readonly AdminReportResumenRow[];
  subtotal: number;
}>;

export function groupAdminReportResumenByAsesor(
  resumen: readonly AdminReportResumenRow[],
): AdminReportTableGroup[] {
  const order: string[] = [];
  const map = new Map<string, AdminReportResumenRow[]>();
  for (const row of resumen) {
    const list = map.get(row.asesor_id);
    if (list) {
      list.push(row);
    } else {
      order.push(row.asesor_id);
      map.set(row.asesor_id, [row]);
    }
  }
  return order.map((id) => {
    const rows = map.get(id) ?? [];
    const first = rows[0]!;
    return {
      asesorId: id,
      asesorNombre: first.asesor_nombre,
      asesorEmail: first.asesor_email ?? null,
      rows,
      subtotal: rows.reduce((acc, r) => acc + r.total, 0),
    };
  });
}

export function detalleForResumenRow(
  detalle: readonly AdminReportDetalleRow[],
  row: AdminReportResumenRow,
): AdminReportDetalleRow[] {
  return detalle.filter(
    (d) => d.asesor_id === row.asesor_id && d.paso_visual === row.paso_visual,
  );
}

export function formatAdminReportMetaSummary(
  meta: AdminReportMeta,
  consulted?: Pick<AdminReportFilters, "asesorIds" | "pasosVisuales"> | null,
): string {
  const asesoresSel = consulted?.asesorIds.length ?? meta.asesores;
  const etapasConsultadas = consulted?.pasosVisuales.length ?? meta.pasos;
  const etapasConResultados = meta.pasos;
  const n = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;

  let base = [
    n(asesoresSel, "asesor seleccionado", "asesores seleccionados"),
    n(etapasConsultadas, "etapa consultada", "etapas consultadas"),
    n(etapasConResultados, "etapa con resultados", "etapas con resultados"),
    n(meta.expedientes, "expediente", "expedientes"),
  ].join(" · ");

  const excluidos = meta.excluidos_por_fecha_desconocida ?? 0;
  if (excluidos > 0) {
    base += ` · ${excluidos} sin fecha histórica excluidos`;
  }
  return base;
}

export function adminReportHasFechaRango(filters: {
  fechaDesde: string | null;
  fechaHasta: string | null;
}): boolean {
  return Boolean(filters.fechaDesde?.trim() || filters.fechaHasta?.trim());
}

/** Advertencia P114 solo aplica al tracking de entrada al paso (históricos NULL). */
export function adminReportShowsEntradaPasoWarning(filters: {
  tipoFecha: AdminReportTipoFecha;
  fechaDesde: string | null;
  fechaHasta: string | null;
}): boolean {
  return (
    filters.tipoFecha === "entrada_paso_actual" &&
    adminReportHasFechaRango(filters)
  );
}

export function resolveDetalleFechaFiltrada(
  row: AdminReportDetalleRow,
  tipo: AdminReportTipoFecha | null | undefined,
): string | null {
  if (tipo === "envio_mesa") {
    return row.fecha_envio_mesa ?? null;
  }
  return row.fecha_entrada_paso_actual ?? null;
}

export function labelDetalleFechaFiltrada(
  tipo: AdminReportTipoFecha | null | undefined,
): string {
  return tipo === "envio_mesa"
    ? "Fecha de envío a Mesa"
    : "Fecha de entrada al paso";
}

export function asesoresCatalogFromReport(
  report: AdminReportResponse,
): ReadonlyArray<{ id: string; nombre: string; email: string | null }> {
  const map = new Map<string, { id: string; nombre: string; email: string | null }>();
  for (const row of report.resumen) {
    if (!map.has(row.asesor_id)) {
      map.set(row.asesor_id, {
        id: row.asesor_id,
        nombre: row.asesor_nombre,
        email: row.asesor_email ?? null,
      });
    }
  }
  for (const row of report.detalle) {
    if (!map.has(row.asesor_id)) {
      map.set(row.asesor_id, {
        id: row.asesor_id,
        nombre: row.asesor_nombre,
        email: row.asesor_email ?? null,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es"),
  );
}
