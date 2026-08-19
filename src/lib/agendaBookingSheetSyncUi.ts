/**
 * Copy de sync CRM→agenda. El RPC de booking solo confirma Supabase;
 * Drive/Sheets se confirma con agenda_booking_sheet_sync_status.
 */

export type AgendaBookingSheetSyncKind = "book" | "reagendar";

export type AgendaBookingSheetSyncStatus = "PENDING" | "SYNCED" | "FAILED";

export const AGENDA_SHEET_SYNC_POLL = {
  intervalMs: 2500,
  maxAttempts: 8,
} as const;

export function agendaBookingCrmSuccessCopy(
  kind: AgendaBookingSheetSyncKind,
): string {
  return kind === "reagendar"
    ? "Cita reagendada en CRM · sincronizando con agenda…"
    : "Cita agendada en CRM · sincronizando con agenda…";
}

export function agendaBookingSyncConfirmedCopy(
  kind: AgendaBookingSheetSyncKind,
): string {
  return kind === "reagendar"
    ? "Cita reagendada y sincronizada con agenda."
    : "Cita agendada y sincronizada con agenda.";
}

export function agendaBookingSyncPendingTimeoutCopy(): string {
  return "Tu cita está guardada en CRM. La sincronización con agenda sigue pendiente.";
}

export function agendaBookingSyncFailedCopy(): string {
  return "Tu cita está guardada en CRM, pero la agenda externa no pudo sincronizarse. Mesa fue notificada / reintento pendiente.";
}

export function nextAgendaBookingSheetSyncUi(input: {
  kind: AgendaBookingSheetSyncKind;
  status: AgendaBookingSheetSyncStatus | null;
  attempts: number;
  maxAttempts?: number;
}): { message: string; continuePolling: boolean } {
  const max = input.maxAttempts ?? AGENDA_SHEET_SYNC_POLL.maxAttempts;
  if (input.status === "SYNCED") {
    return {
      message: agendaBookingSyncConfirmedCopy(input.kind),
      continuePolling: false,
    };
  }
  if (input.status === "FAILED") {
    return {
      message: agendaBookingSyncFailedCopy(),
      continuePolling: false,
    };
  }
  if (input.attempts >= max) {
    return {
      message: agendaBookingSyncPendingTimeoutCopy(),
      continuePolling: false,
    };
  }
  return {
    message: agendaBookingCrmSuccessCopy(input.kind),
    continuePolling: true,
  };
}
