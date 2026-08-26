/**
 * B1.5 P161 — contratos Zod de RPCs inbox asesor (sin cablear UI).
 * Equivalencia: docs/ASESOR_INBOX_B15_EQUIVALENCIA.md
 */
import { z } from "zod";

export const ASESOR_INBOX_DEFAULT_PAGE_SIZE = 25;
export const ASESOR_INBOX_MAX_PAGE_SIZE = 100;
export const ASESOR_INBOX_NOTIF_DEFAULT_LIMIT = 50;

export const asesorInboxQuickFilterSchema = z.enum([
  "todos",
  "en_tramite",
  "correccion_requerida",
  "correccion_enviada",
  "rechazados_mesa",
  "cancelados",
  "agendar_biometricos",
  "agendar_firma",
  "subir_acuse",
]);

export type AsesorInboxQuickFilter = z.infer<typeof asesorInboxQuickFilterSchema>;

export const asesorInboxResultadoRealSchema = z.enum([
  "cancelado",
  "rechazado_mesa",
  "en_tramite",
  "no_cumple_editor",
  "aprobado_editor",
  "pendiente_editor",
]);

export const asesorInboxCategoriaCorreccionSchema = z.enum([
  "faltantes",
  "correccion_requerida",
  "correccion_enviada",
  "pendiente_revision_documental",
  "documentos_validados",
]);

export const asesorListExpedientesPageInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(ASESOR_INBOX_MAX_PAGE_SIZE)
    .default(ASESOR_INBOX_DEFAULT_PAGE_SIZE),
  buscar: z.string().nullable().optional(),
  decision: z.string().nullable().optional(),
  estatus_operativo: z.string().nullable().optional(),
  resultado_real: asesorInboxResultadoRealSchema.nullable().optional(),
  programa: z.string().nullable().optional(),
  etapa_exacta: z.number().int().nullable().optional(),
  fecha_desde: z.string().nullable().optional(), // YYYY-MM-DD
  fecha_hasta: z.string().nullable().optional(),
  quick_filter: asesorInboxQuickFilterSchema.default("todos"),
});

export type AsesorListExpedientesPageInput = z.infer<
  typeof asesorListExpedientesPageInputSchema
>;

export const asesorListExpedienteItemSchema = z.object({
  id: z.string().uuid(),
  programa: z.string(),
  programa_db: z.string().optional(),
  nss: z.string(),
  cliente_nombre: z.string(),
  telefono_cliente: z.string().nullable().optional(),
  direccion_opcional: z.string().nullable().optional(),
  asesor_id: z.string().uuid(),
  origen_mesa: z.string().nullable().optional(),
  submitted_to_mesa: z.boolean(),
  fecha_envio_mesa: z.string().nullable().optional(),
  etapa_actual: z.number().nullable().optional(),
  subestado: z.string().nullable().optional(),
  ciclo_estado: z.string().nullable().optional(),
  motivo_rechazo: z.string().nullable().optional(),
  comentario_rechazo: z.string().nullable().optional(),
  fecha_cita: z.string().nullable().optional(),
  firma_agendable_desde: z.string().nullable().optional(),
  pago_concasa_resultado: z.string().nullable().optional(),
  pago_concasa_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  expediente_anterior_id: z.string().uuid().nullable().optional(),
  reingreso_rechazo_id: z.string().uuid().nullable().optional(),
  reingreso_manual_count: z.number().nullable().optional(),
  reingreso_manual_at: z.string().nullable().optional(),
  reingreso_manual_by: z.string().uuid().nullable().optional(),
  reprecalificacion_pendiente_id: z.string().uuid().nullable().optional(),
  decision: z.string(),
  monto_aprobado: z.union([z.number(), z.string()]).nullable().optional(),
  notas_revision: z.string().optional(),
  aprobado_at: z.string().nullable().optional(),
  monto_aprobado_al_aprobar: z.union([z.number(), z.string()]).nullable().optional(),
  no_cumple_at: z.string().nullable().optional(),
  resultado_real: asesorInboxResultadoRealSchema,
  categoria_correccion: asesorInboxCategoriaCorreccionSchema,
  /** P197: cola/chip. Ortogonal a columnas resultado_real / categoria_correccion. */
  estado_efectivo: z.string().nullable().optional(),
  /** P209: explicación causal first paint cuando correccion_requerida. */
  correccion_explicacion: z.string().nullable().optional(),
  /** P210: resumen compacto (labels + motivo + ux_state). */
  correccion_resumen: z
    .object({
      count: z.number().int().nonnegative(),
      labels: z.array(z.string()),
      first_motivo: z.string().nullable().optional(),
      ux_state: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** P183: estado de re-precal REAL (ortogonal a resultado_real). */
  reprecal_estado: z.enum(["pending", "approved", "no_cumple"]).nullable().optional(),
  reprecal_solicitada_at: z.string().nullable().optional(),
  reprecal_resuelta_at: z.string().nullable().optional(),
  reprecal_activity_at: z.string().nullable().optional(),
  reprecal_monto_previo: z.union([z.number(), z.string()]).nullable().optional(),
  reprecal_monto_resultado: z.union([z.number(), z.string()]).nullable().optional(),
  reprecal_programa_solicitado: z.string().nullable().optional(),
});

export type AsesorListExpedienteItem = z.infer<
  typeof asesorListExpedienteItemSchema
>;

export const asesorListExpedientesPageResultSchema = z.object({
  items: z.array(asesorListExpedienteItemSchema),
  total_count: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
  has_more: z.boolean(),
});

export type AsesorListExpedientesPageResult = z.infer<
  typeof asesorListExpedientesPageResultSchema
>;

export const asesorInboxCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  aprobados_editor: z.number().int().nonnegative(),
  no_cumple: z.number().int().nonnegative(),
  en_tramite: z.number().int().nonnegative(),
  rechazados_mesa: z.number().int().nonnegative(),
  cancelados: z.number().int().nonnegative(),
  correccion_requerida: z.number().int().nonnegative(),
  correccion_enviada: z.number().int().nonnegative(),
  agendar_biometricos: z.number().int().nonnegative(),
  agendar_firma: z.number().int().nonnegative(),
  subir_acuse: z.number().int().nonnegative(),
});

export const asesorInboxNotificationSchema = z.object({
  id: z.string(),
  expediente_id: z.string().uuid(),
  cliente_nombre: z.string(),
  kind: z.string(),
  tipo_label: z.string(),
  mensaje: z.string(),
  fecha: z.string().nullable().optional(),
  prioridad: z.number().int(),
  href: z.string(),
});

export const asesorInboxSummaryResultSchema = z.object({
  counts: asesorInboxCountsSchema,
  programas_unicos: z.array(z.string()),
  notifications: z.array(asesorInboxNotificationSchema),
});

export type AsesorInboxSummaryResult = z.infer<
  typeof asesorInboxSummaryResultSchema
>;

/** Normaliza page/page_size como la RPC (default 25, max 100). */
export function normalizeAsesorInboxPageOptions(input: {
  page?: number;
  page_size?: number;
}): { page: number; page_size: number; from: number; to: number } {
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const page_size = Math.min(
    ASESOR_INBOX_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(input.page_size ?? ASESOR_INBOX_DEFAULT_PAGE_SIZE) || 1),
  );
  const from = (page - 1) * page_size;
  return { page, page_size, from, to: from + page_size - 1 };
}
