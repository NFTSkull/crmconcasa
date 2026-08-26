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
  code?: string | null;
};

type InvokeErrorLike = {
  message?: string;
  context?: Response;
};

type SupabaseLike = {
  functions: {
    invoke: (
      name: string,
      opts: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: InvokeErrorLike | null }>;
  };
};

async function readInvokePayload(
  data: unknown,
  error: InvokeErrorLike | null,
): Promise<Record<string, unknown> | null> {
  if (data && typeof data === "object") {
    const raw = data as Record<string, unknown>;
    const payload =
      raw.data && typeof raw.data === "object"
        ? (raw.data as Record<string, unknown>)
        : raw;
    return payload;
  }
  const ctx = error?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body && typeof body === "object") {
        return body as Record<string, unknown>;
      }
    } catch {
      /* ignore parse errors */
    }
  }
  return null;
}

function toLiveSyncResult(payload: Record<string, unknown>): LiveSyncResult | null {
  if (payload.fresh !== true && payload.fresh !== false) {
    const code = typeof payload.code === "string" ? payload.code : null;
    if (!code) return null;
    return {
      ok: false,
      fresh: false,
      enforced: payload.enforced !== false,
      slots: [],
      refreshed: false,
      upserted: 0,
      canBook: false,
      gateMessage:
        typeof payload.gateMessage === "string" ? payload.gateMessage : null,
      bookMessage: BOOK_SLOT_JUST_TAKEN_MESSAGE,
      anomalies: [],
      anomaly_count: 0,
      code,
    };
  }
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
    code: typeof payload.code === "string" ? payload.code : null,
  };
}

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
  const payload = await readInvokePayload(data, error);
  if (!payload) return null;
  return toLiveSyncResult(payload);
}

type SupabaseAvailabilityClient = SupabaseLike & {
  rpc: (fn: string, args: Record<string, unknown>) => unknown;
};

/** availability live-sync → fallback RPC inventario (fuente única para FE). */
export async function fetchBiometricSheetAvailability(
  client: SupabaseAvailabilityClient,
  input: {
    bookingDate: string;
    locationId: string;
  },
): Promise<InventoryAvailabilityResponse> {
  const live = await invokeAgendaSheetLiveSync(client, {
    bookingDate: input.bookingDate,
    kind: "biometricos",
    locationId: input.locationId,
    mode: "availability",
  });
  if (live) return live;
  const rpcResult = (await client.rpc("agenda_sheet_inventory_availability", {
    p_kind: "biometricos",
    p_date: input.bookingDate,
    p_location_id: input.locationId,
  })) as { data: unknown; error: { message?: string } | null };
  const { data, error } = rpcResult;
  if (error || !data || typeof data !== "object") {
    return { fresh: false, enforced: true, slots: [] };
  }
  return data as InventoryAvailabilityResponse;
}
