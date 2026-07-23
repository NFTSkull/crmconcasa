import { z } from "zod";

export const agendaBookingDecisionKindSchema = z.enum([
  "biometricos",
  "firmas",
  "notificacion",
]);
export type AgendaBookingDecisionKind = z.infer<typeof agendaBookingDecisionKindSchema>;

export const agendaBookingDecisionActionSchema = z.enum([
  "reagendar",
  "cancelar",
  "cancelar_continuar",
  "cancel_continue",
]);
export type AgendaBookingDecisionAction = z.infer<typeof agendaBookingDecisionActionSchema>;

export const agendaBookingDecisionRowSchema = z.object({
  id: z.string().uuid(),
  kind: agendaBookingDecisionKindSchema,
  decision: agendaBookingDecisionActionSchema,
  motivo: z.string(),
  decided_at: z.string(),
  decided_by_name: z.string().nullable().optional(),
  previous_booking_date: z.string().nullable().optional(),
  previous_booking_time: z.string().nullable().optional(),
  previous_location_id: z.string().nullable().optional(),
  new_booking_date: z.string().nullable().optional(),
  new_booking_time: z.string().nullable().optional(),
  new_location_id: z.string().nullable().optional(),
  etapa_anterior: z.number().nullable().optional(),
  etapa_nueva: z.number().nullable().optional(),
});

export type AgendaBookingDecisionRow = z.infer<typeof agendaBookingDecisionRowSchema>;

export type AgendaBookingDecision = Readonly<{
  id: string;
  kind: AgendaBookingDecisionKind;
  decision: AgendaBookingDecisionAction;
  motivo: string;
  decidedAt: string;
  decidedByName: string | null;
  previousBookingDate: string | null;
  previousBookingTime: string | null;
  previousLocationId: string | null;
  newBookingDate: string | null;
  newBookingTime: string | null;
  newLocationId: string | null;
  etapaAnterior: number | null;
  etapaNueva: number | null;
}>;

export function mapAgendaBookingDecisionRow(
  row: AgendaBookingDecisionRow,
): AgendaBookingDecision {
  return {
    id: row.id,
    kind: row.kind,
    decision: row.decision,
    motivo: row.motivo,
    decidedAt: row.decided_at,
    decidedByName: row.decided_by_name ?? null,
    previousBookingDate: row.previous_booking_date
      ? String(row.previous_booking_date).slice(0, 10)
      : null,
    previousBookingTime: row.previous_booking_time
      ? String(row.previous_booking_time).slice(0, 5)
      : null,
    previousLocationId: row.previous_location_id ?? null,
    newBookingDate: row.new_booking_date
      ? String(row.new_booking_date).slice(0, 10)
      : null,
    newBookingTime: row.new_booking_time
      ? String(row.new_booking_time).slice(0, 5)
      : null,
    newLocationId: row.new_location_id ?? null,
    etapaAnterior:
      typeof row.etapa_anterior === "number" ? row.etapa_anterior : null,
    etapaNueva: typeof row.etapa_nueva === "number" ? row.etapa_nueva : null,
  };
}

export const mesaGestionarCitaActionSchema = z.enum([
  "reagendar",
  "cancelar",
  "cancelar_continuar",
  "cancel_continue",
]);
export type MesaGestionarCitaAction = z.infer<typeof mesaGestionarCitaActionSchema>;

export const mesaGestionarCitaResultSchema = z.object({
  ok: z.literal(true),
  action: z.string(),
  decision_id: z.string().uuid().optional().nullable(),
  new_booking_id: z.string().uuid().nullable().optional(),
  result: z.unknown().optional(),
});

export type MesaGestionarCitaResult = z.infer<typeof mesaGestionarCitaResultSchema>;

export const mesaCancelarCitaYContinuarResultSchema = z.object({
  ok: z.literal(true),
  action: z.literal("cancel_continue").optional(),
  idempotent: z.boolean().optional(),
  decision_id: z.string().uuid().optional().nullable(),
  booking_id: z.string().uuid().optional(),
  expediente_id: z.string().uuid().optional(),
  kind: z.string().optional(),
  etapa_anterior: z.number().optional(),
  etapa_nueva: z.number().optional(),
  fecha_cita: z.null().optional(),
  status: z.string().optional(),
});

export type MesaCancelarCitaYContinuarResult = z.infer<
  typeof mesaCancelarCitaYContinuarResultSchema
>;

export function isCancelContinueDecision(
  decision: AgendaBookingDecisionAction,
): boolean {
  return decision === "cancel_continue" || decision === "cancelar_continuar";
}

export function formatAgendaDecisionLabel(decision: AgendaBookingDecisionAction): string {
  if (decision === "reagendar") return "Cita reagendada por Mesa";
  if (decision === "cancelar") return "Cita cancelada por Mesa";
  if (isCancelContinueDecision(decision)) {
    return "Mesa canceló la cita y autorizó continuar";
  }
  return "Decisión de Mesa";
}

export function formatAgendaDecisionKindLabel(kind: AgendaBookingDecisionKind): string {
  if (kind === "biometricos") return "Biométricos";
  if (kind === "firmas") return "Firmas";
  return "Notificación extraordinaria";
}
