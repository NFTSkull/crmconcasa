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
  agendaKind: "biometricos" | "firmas" = "biometricos",
): string {
  if (agendaKind === "firmas") {
    return kind === "reagendar"
      ? "Cita de firmas reagendada en CRM · sincronizando con agenda…"
      : "Cita de firmas guardada en CRM · sincronizando con agenda…";
  }
  return kind === "reagendar"
    ? "Cita reagendada en CRM · sincronizando con agenda…"
    : "Cita agendada en CRM · sincronizando con agenda…";
}

export function agendaBookingSyncConfirmedCopy(
  kind: AgendaBookingSheetSyncKind,
  agendaKind: "biometricos" | "firmas" = "biometricos",
): string {
  if (agendaKind === "firmas") {
    return kind === "reagendar"
      ? "Cita de firmas reagendada y sincronizada con agenda."
      : "Cita de firmas sincronizada con agenda.";
  }
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
  agendaKind?: "biometricos" | "firmas";
}): { message: string; continuePolling: boolean; done: boolean } {
  const max = input.maxAttempts ?? AGENDA_SHEET_SYNC_POLL.maxAttempts;
  const agendaKind = input.agendaKind ?? "biometricos";
  if (input.status === "SYNCED") {
    return {
      message: agendaBookingSyncConfirmedCopy(input.kind, agendaKind),
      continuePolling: false,
      done: true,
    };
  }
  if (input.status === "FAILED") {
    return {
      message: agendaBookingSyncFailedCopy(),
      continuePolling: false,
      done: true,
    };
  }
  if (input.attempts >= max) {
    return {
      message: agendaBookingSyncPendingTimeoutCopy(),
      continuePolling: false,
      done: true,
    };
  }
  return {
    message: agendaBookingCrmSuccessCopy(input.kind, agendaKind),
    continuePolling: true,
    done: false,
  };
}
