import type { AgendaBookingSheetSyncStatus } from "@/lib/agendaBookingSheetSyncUi";

type SupabaseRpcLike = {
  rpc: (fn: string, args: Record<string, unknown>) => unknown;
};

export type AgendaBookingSheetSyncReadModel = Readonly<{
  bookingId: string;
  syncStatus: AgendaBookingSheetSyncStatus;
  lastSyncedAt: string | null;
  syncPending: boolean;
  syncError: boolean;
}>;

export function mapAgendaBookingSheetSyncRpc(
  data: unknown,
): AgendaBookingSheetSyncReadModel | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.ok === false) return null;
  const statusRaw = String(row.sync_status ?? "").toUpperCase();
  if (
    statusRaw !== "PENDING" &&
    statusRaw !== "SYNCED" &&
    statusRaw !== "FAILED"
  ) {
    return null;
  }
  const bookingId = String(row.booking_id ?? "").trim();
  if (!bookingId) return null;
  return {
    bookingId,
    syncStatus: statusRaw,
    lastSyncedAt:
      typeof row.last_synced_at === "string" && row.last_synced_at
        ? row.last_synced_at
        : null,
    syncPending: row.sync_pending === true || statusRaw === "PENDING",
    syncError: row.sync_error === true || statusRaw === "FAILED",
  };
}

export async function fetchAgendaBookingSheetSyncStatus(
  client: unknown,
  bookingId: string,
): Promise<AgendaBookingSheetSyncStatus | null> {
  const id = String(bookingId ?? "").trim();
  if (!client || !id || typeof client !== "object" || !("rpc" in client)) {
    return null;
  }
  const rpc = (client as SupabaseRpcLike).rpc;
  const result = (await rpc("agenda_booking_sheet_sync_status", {
    p_booking_id: id,
  })) as { data: unknown; error: { message?: string } | null };
  if (result?.error) return null;
  return mapAgendaBookingSheetSyncRpc(result?.data)?.syncStatus ?? null;
}
