/**
 * P172 B1 — Contingencia extraordinaria de citas (contrato FE puro).
 * Sin UI de botón Mesa en B1; RPCs certificadas en SQL.
 */

import { z } from "zod";

export const AGENDA_CONTINGENCY_KINDS = ["biometricos", "firmas"] as const;
export type AgendaContingencyKind = (typeof AGENDA_CONTINGENCY_KINDS)[number];

export const AGENDA_CONTINGENCY_STATUSES = ["active", "closed"] as const;
export type AgendaContingencyStatus =
  (typeof AGENDA_CONTINGENCY_STATUSES)[number];

export const AGENDA_CONTINGENCY_ITEM_STATUSES = [
  "pending_rebook",
  "rebooked",
  "closed",
] as const;
export type AgendaContingencyItemStatus =
  (typeof AGENDA_CONTINGENCY_ITEM_STATUSES)[number];

export const EXTRAORDINARY_REBOOK_TASK_KIND =
  "extraordinary_rebook_required" as const;

/** Prioridad campana: debajo de corrección/rechazo (1–3), encima de cita_programada (7). */
export const EXTRAORDINARY_REBOOK_PRIORITY = 4 as const;

export const CONTINGENCY_BADGE_LABEL = "CONTINGENCIA · NO HUBO CITA" as const;

export const agendaContingencyKindSchema = z.enum(AGENDA_CONTINGENCY_KINDS);
export const agendaContingencyLocationSchema = z
  .enum(["monterrey", "apodaca"])
  .nullable()
  .optional();

export const declararContingenciaInputSchema = z.object({
  affected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: agendaContingencyKindSchema,
  location_id: z.enum(["monterrey", "apodaca"]).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});

export type DeclararContingenciaInput = z.infer<
  typeof declararContingenciaInputSchema
>;

export const declararContingenciaResultSchema = z.object({
  ok: z.literal(true),
  contingency_id: z.string().uuid(),
  affected_count: z.number().int().nonnegative(),
  advisor_count: z.number().int().nonnegative(),
  kind: agendaContingencyKindSchema,
  date: z.string(),
  location_id: z.string().nullable().optional(),
  reused: z.boolean().optional(),
});

export type DeclararContingenciaResult = z.infer<
  typeof declararContingenciaResultSchema
>;

export const agendarCitaExtraordinariaInputSchema = z.object({
  contingency_item_id: z.string().uuid(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().min(4).max(12),
  location_id: z.enum(["monterrey", "apodaca"]),
});

export type AgendarCitaExtraordinariaInput = z.infer<
  typeof agendarCitaExtraordinariaInputSchema
>;

export const agendarCitaExtraordinariaResultSchema = z.object({
  ok: z.literal(true),
  extraordinary_booking_id: z.string().uuid(),
  contingency_item_id: z.string().uuid(),
  contingency_id: z.string().uuid(),
  original_booking_id: z.string().uuid(),
  status: z.literal("rebooked"),
  etapa_actual: z.number().int().optional(),
  subestado: z.string().optional(),
});

export type AgendarCitaExtraordinariaResult = z.infer<
  typeof agendarCitaExtraordinariaResultSchema
>;

export const contingenciaPendienteItemSchema = z.object({
  contingency_item_id: z.string().uuid(),
  contingency_id: z.string().uuid(),
  expediente_id: z.string().uuid(),
  original_booking_id: z.string().uuid(),
  item_status: z.literal("pending_rebook"),
  affected_date: z.string(),
  kind: agendaContingencyKindSchema,
  contingency_location_id: z.string().nullable().optional(),
  reason: z.string(),
  task_kind: z.literal(EXTRAORDINARY_REBOOK_TASK_KIND),
});

export type ContingenciaPendienteItem = z.infer<
  typeof contingenciaPendienteItemSchema
>;

/** Outcome P170 extendido por P172. */
export const APPLY_OUTCOME_SKIPPED_CONTINGENCY = "SKIPPED_CONTINGENCY" as const;

export function isExtraordinaryRebookPending(
  itemStatus: string | null | undefined,
  contingencyStatus: string | null | undefined,
): boolean {
  return (
    itemStatus === "pending_rebook" && contingencyStatus === "active"
  );
}
