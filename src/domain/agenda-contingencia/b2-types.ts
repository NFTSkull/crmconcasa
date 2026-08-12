/**
 * P172 B2 — tipos adicionales (preview / listados Mesa / expediente).
 */
import { z } from "zod";
import {
  agendaContingencyKindSchema,
  AGENDA_CONTINGENCY_ITEM_STATUSES,
  AGENDA_CONTINGENCY_STATUSES,
} from "./types";

export const contingenciaPreviewResultSchema = z.object({
  ok: z.literal(true),
  affected_date: z.string(),
  kind: agendaContingencyKindSchema,
  location_id: z.string().nullable().optional(),
  affected_count: z.number().int().nonnegative(),
  advisor_count: z.number().int().nonnegative(),
});
export type ContingenciaPreviewResult = z.infer<
  typeof contingenciaPreviewResultSchema
>;

export const mesaContingenciaHeaderSchema = z.object({
  contingency_id: z.string().uuid(),
  affected_date: z.string(),
  kind: agendaContingencyKindSchema,
  location_id: z.string().nullable().optional(),
  reason: z.string(),
  status: z.enum(AGENDA_CONTINGENCY_STATUSES),
  created_at: z.string().optional(),
  affected_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  rebooked_count: z.number().int().nonnegative().optional().default(0),
});
export type MesaContingenciaHeader = z.infer<typeof mesaContingenciaHeaderSchema>;

export const mesaContingenciaItemSchema = z.object({
  contingency_item_id: z.string().uuid(),
  contingency_id: z.string().uuid(),
  original_booking_id: z.string().uuid(),
  expediente_id: z.string().uuid(),
  item_status: z.enum(AGENDA_CONTINGENCY_ITEM_STATUSES),
  extraordinary_booking_id: z.string().uuid().nullable().optional(),
  affected_date: z.string(),
  kind: agendaContingencyKindSchema,
  contingency_location_id: z.string().nullable().optional(),
  reason: z.string(),
  contingency_status: z.enum(AGENDA_CONTINGENCY_STATUSES),
  extraordinary_date: z.string().nullable().optional(),
  extraordinary_time: z.string().nullable().optional(),
  extraordinary_location_id: z.string().nullable().optional(),
});
export type MesaContingenciaItem = z.infer<typeof mesaContingenciaItemSchema>;

export const asesorContingenciaExpedienteItemSchema = z.object({
  contingency_item_id: z.string().uuid(),
  contingency_id: z.string().uuid(),
  original_booking_id: z.string().uuid(),
  expediente_id: z.string().uuid(),
  item_status: z.enum(["pending_rebook", "rebooked", "closed"]),
  extraordinary_booking_id: z.string().uuid().nullable().optional(),
  affected_date: z.string(),
  kind: agendaContingencyKindSchema,
  contingency_location_id: z.string().nullable().optional(),
  reason: z.string(),
  contingency_status: z.enum(AGENDA_CONTINGENCY_STATUSES),
  original_date: z.string().nullable().optional(),
  original_time: z.string().nullable().optional(),
  original_location_id: z.string().nullable().optional(),
  extraordinary_date: z.string().nullable().optional(),
  extraordinary_time: z.string().nullable().optional(),
  extraordinary_location_id: z.string().nullable().optional(),
});
export type AsesorContingenciaExpedienteItem = z.infer<
  typeof asesorContingenciaExpedienteItemSchema
>;

/** Horarios válidos (catálogo) — sin remaining capacity. */
export const EXTRAORDINARY_DEFAULT_SLOTS = [
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
] as const;

export function normalizeExtraordinarySlots(
  slots: readonly string[] | null | undefined,
): string[] {
  const out: string[] = [];
  for (const s of slots ?? []) {
    const t = String(s).trim();
    if (/^\d{2}:\d{2}$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out.length ? out.sort() : [...EXTRAORDINARY_DEFAULT_SLOTS];
}
