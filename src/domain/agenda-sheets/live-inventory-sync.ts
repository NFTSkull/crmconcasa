/**
 * Cliente FE: live-sync Sheet → inventario antes de listar / reservar.
 */
import type { InventoryAvailabilityResponse } from "./apply-inventory-availability";
import {
  BOOK_SLOT_JUST_TAKEN_MESSAGE,
  LIVE_SYNC_LOADING_LABEL,
} from "./manual-occupancy";

export { BOOK_SLOT_JUST_TAKEN_MESSAGE, LIVE_SYNC_LOADING_LABEL };

export type LiveSyncMode = "availability" | "book_gate";

export type LiveSyncResult = InventoryAvailabilityResponse & {
  refreshed?: boolean;
  upserted?: number;
  canBook?: boolean;
  gateMessage?: string | null;
  bookMessage?: string;
  anomalies?: unknown[];
  anomaly_count?: number;
};

type SupabaseLike = {
  functions: {
    invoke: (
      name: string,
      opts: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
};

export async function invokeAgendaSheetLiveSync(
  client: SupabaseLike,
  input: {
    bookingDate: string;
    kind: "biometricos" | "firmas" | "inscripcion";
    locationId: "monterrey" | "apodaca" | string;
    mode?: LiveSyncMode;
    slotTime?: string;
  },
): Promise<LiveSyncResult | null> {
  const { data, error } = await client.functions.invoke("agenda-sheet-live-sync", {
    body: {
      bookingDate: input.bookingDate,
      kind: input.kind,
      locationId: input.locationId,
      mode: input.mode ?? "availability",
      slotTime: input.slotTime ?? undefined,
    },
  });
  if (error || !data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  // Edge jsonOk suele envolver en { ok, ... } o devolver plano
  const payload = (raw.data && typeof raw.data === "object"
    ? raw.data
    : raw) as Record<string, unknown>;
  if (payload.fresh !== true && payload.fresh !== false) return null;
  return {
    ok: true,
    fresh: payload.fresh === true,
    enforced: payload.enforced !== false,
    slots: Array.isArray(payload.slots)
      ? (payload.slots as InventoryAvailabilityResponse["slots"])
      : [],
    refreshed: payload.refreshed === true,
    upserted: Number(payload.upserted) || 0,
    canBook: payload.canBook !== false,
    daily_remaining:
      payload.daily_remaining == null && payload.dailyRemaining == null
        ? undefined
        : Number(payload.daily_remaining ?? payload.dailyRemaining),
    gateMessage:
      typeof payload.gateMessage === "string" ? payload.gateMessage : null,
    bookMessage:
      typeof payload.bookMessage === "string"
        ? payload.bookMessage
        : BOOK_SLOT_JUST_TAKEN_MESSAGE,
    anomalies: Array.isArray(payload.anomalies) ? payload.anomalies : [],
    anomaly_count: Number(payload.anomaly_count) || 0,
  };
}
