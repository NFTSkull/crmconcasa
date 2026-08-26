/**
 * P210 — read-model causal de corrección asesor (motivo exacto + reenvío).
 * Espejo SQL: asesor_correccion_detalle / asesor_inbox_correccion_resumen.
 */
import { z } from "zod";
import {
  ASESOR_SECCION_DG_ID,
  ASESOR_SECCION_DOCS_ID,
  ASESOR_SECCION_RETENCION_ID,
  type AsesorCorreccionActionKind,
} from "./asesor-expediente-correccion-ui";

export const asesorCorreccionUxStateSchema = z.enum([
  "PENDIENTE_DE_CORREGIR",
  "CAMBIOS_GUARDADOS_SIN_ENVIAR",
  "CORRECCION_ENVIADA",
]);

export type AsesorCorreccionUxState = z.infer<typeof asesorCorreccionUxStateSchema>;

export const asesorCorreccionItemLocalStatusSchema = z.enum([
  "pendiente",
  "corregido_guardado",
  "reemplazado",
]);

export const asesorCorreccionItemSchema = z.object({
  type: z.enum(["datos_generales", "documento", "retencion"]),
  key: z.string(),
  label: z.string(),
  motivo: z.string(),
  requested_at: z.string().nullable().optional(),
  action_target: z.string(),
  local_status: asesorCorreccionItemLocalStatusSchema,
});

export type AsesorCorreccionItem = z.infer<typeof asesorCorreccionItemSchema>;

export const asesorCorreccionResumenSchema = z.object({
  count: z.number().int().nonnegative(),
  labels: z.array(z.string()),
  first_motivo: z.string().nullable().optional(),
  ux_state: asesorCorreccionUxStateSchema.nullable().optional(),
});

export type AsesorCorreccionResumen = z.infer<typeof asesorCorreccionResumenSchema>;

export const asesorCorreccionDetalleSchema = z.object({
  estado: z.string(),
  request_type: z.string().nullable().optional(),
  request_at: z.string().nullable().optional(),
  items: z.array(asesorCorreccionItemSchema),
  has_correction_activity_after_request: z.boolean(),
  has_response_after_request: z.boolean(),
  needs_resubmit: z.boolean(),
  can_resubmit: z.boolean(),
  ux_state: asesorCorreccionUxStateSchema.nullable().optional(),
  blocking_reasons: z.array(z.string()),
});

export type AsesorCorreccionDetalle = z.infer<typeof asesorCorreccionDetalleSchema>;

export const asesorReenviarCorreccionResultSchema = z.object({
  ok: z.boolean(),
  already_submitted: z.boolean().optional(),
  lote_id: z.string().uuid().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  copied_cambios: z.number().int().nonnegative().optional(),
});

export type AsesorReenviarCorreccionResult = z.infer<
  typeof asesorReenviarCorreccionResultSchema
>;

export function parseAsesorCorreccionDetalle(
  raw: unknown,
): AsesorCorreccionDetalle | null {
  if (raw == null) return null;
  const parsed = asesorCorreccionDetalleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseAsesorCorreccionResumen(
  raw: unknown,
): AsesorCorreccionResumen | null {
  if (raw == null) return null;
  const parsed = asesorCorreccionResumenSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function correccionItemFocusId(item: AsesorCorreccionItem): string {
  if (item.type === "datos_generales") return ASESOR_SECCION_DG_ID;
  if (item.type === "retencion") return ASESOR_SECCION_RETENCION_ID;
  return ASESOR_SECCION_DOCS_ID;
}

export function correccionItemCtaLabel(item: AsesorCorreccionItem): string {
  if (item.type === "datos_generales") return "Ir a Datos generales";
  if (item.type === "retencion") return "Ir a Retención";
  return "Ir al documento";
}

export function correccionItemKind(item: AsesorCorreccionItem): AsesorCorreccionActionKind {
  if (item.type === "datos_generales") return "dg";
  if (item.type === "retencion") return "retencion";
  return "documento";
}

export function correccionItemLocalStatusLabel(
  status: AsesorCorreccionItem["local_status"],
): string {
  switch (status) {
    case "corregido_guardado":
      return "Corregido / guardado";
    case "reemplazado":
      return "Reemplazado";
    default:
      return "Pendiente";
  }
}

export function formatAsesorCorreccionInboxSecondary(
  resumen: AsesorCorreccionResumen | null | undefined,
): string | null {
  if (!resumen || resumen.count <= 0) return null;
  const labels = resumen.labels.filter((l) => l.trim().length > 0);
  const motivo = (resumen.first_motivo ?? "").trim();

  if (resumen.count === 1) {
    const head = labels[0] ?? "Corrección pendiente";
    return motivo ? `${head}\nMotivo: ${motivo}` : head;
  }

  const joined = labels.join(" · ");
  return `${resumen.count} correcciones pendientes\n${joined}`;
}

export function asesorCorreccionUxCopy(
  uxState: AsesorCorreccionUxState | null | undefined,
): string | null {
  switch (uxState) {
    case "PENDIENTE_DE_CORREGIR":
      return "Corrige lo indicado por Mesa y guarda o reemplaza la información necesaria.";
    case "CAMBIOS_GUARDADOS_SIN_ENVIAR":
      return "Cambios guardados. Falta reenviar la corrección a Mesa.";
    case "CORRECCION_ENVIADA":
      return "Corrección enviada a Mesa. En espera de revisión.";
    default:
      return null;
  }
}

export function buildAsesorCorreccionViewFromDetalle(
  detalle: AsesorCorreccionDetalle | null,
  estadoEfectivo: string | null | undefined,
) {
  const estado = (estadoEfectivo ?? "").trim();
  const items = detalle?.items ?? [];
  return {
    showPanel:
      estado === "correccion_requerida" || estado === "correccion_enviada",
    showResubmitCta:
      estado === "correccion_requerida" &&
      detalle?.ux_state === "CAMBIOS_GUARDADOS_SIN_ENVIAR" &&
      detalle?.can_resubmit === true,
    uxState: detalle?.ux_state ?? null,
    uxCopy: asesorCorreccionUxCopy(detalle?.ux_state),
    items,
    canResubmit: detalle?.can_resubmit === true,
    blockingReasons: detalle?.blocking_reasons ?? [],
    needsDgConfirmation: items.some((i) => i.type === "datos_generales"),
    requestAt: detalle?.request_at ?? null,
  };
}
