/**
 * P203: batch de hints de agenda para inbox asesor (bio + firmas + cancelled).
 * Equivalente a getActiveBooking + getLastCancelledBooking por expediente.
 * 2 queries REST (booked + cancelled), no N×4.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AsesorAgendaBookingHintFlags = Readonly<{
  hasActiveBooking: boolean;
  hasLastCancelledBooking: boolean;
}>;

export type AsesorAgendaHintsByExpediente = Readonly<{
  agendaBiometricos: AsesorAgendaBookingHintFlags;
  agendaFirmas: AsesorAgendaBookingHintFlags;
}>;

const EMPTY_HINT: AsesorAgendaBookingHintFlags = {
  hasActiveBooking: false,
  hasLastCancelledBooking: false,
};

function emptyHints(): AsesorAgendaHintsByExpediente {
  return {
    agendaBiometricos: { ...EMPTY_HINT },
    agendaFirmas: { ...EMPTY_HINT },
  };
}

/**
 * Batch: active booked + latest cancelled (por cancelled_at) para biométricos y firmas.
 */
export async function listAsesorAgendaHintsByExpedienteIds(
  client: SupabaseClient,
  expedienteIds: readonly string[],
): Promise<Map<string, AsesorAgendaHintsByExpediente>> {
  const unique = [...new Set(expedienteIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, AsesorAgendaHintsByExpediente>();
  for (const id of unique) out.set(id, emptyHints());
  if (unique.length === 0) return out;

  const [activeRes, cancelledRes] = await Promise.all([
    client
      .from("agenda_bookings")
      .select("expediente_id, kind")
      .in("expediente_id", unique)
      .eq("status", "booked")
      .in("kind", ["biometricos", "firmas"]),
    client
      .from("agenda_bookings")
      .select("expediente_id, kind, cancelled_at")
      .in("expediente_id", unique)
      .eq("status", "cancelled")
      .in("kind", ["biometricos", "firmas"])
      .order("cancelled_at", { ascending: false }),
  ]);

  for (const row of activeRes.data ?? []) {
    const id = String((row as { expediente_id?: string }).expediente_id ?? "").trim();
    const kind = String((row as { kind?: string }).kind ?? "").trim();
    const cur = out.get(id);
    if (!cur || !id) continue;
    if (kind === "biometricos") {
      out.set(id, {
        ...cur,
        agendaBiometricos: { ...cur.agendaBiometricos, hasActiveBooking: true },
      });
    } else if (kind === "firmas") {
      out.set(id, {
        ...cur,
        agendaFirmas: { ...cur.agendaFirmas, hasActiveBooking: true },
      });
    }
  }

  const seenCancelled = new Set<string>();
  for (const row of cancelledRes.data ?? []) {
    const id = String((row as { expediente_id?: string }).expediente_id ?? "").trim();
    const kind = String((row as { kind?: string }).kind ?? "").trim();
    if (!id || (kind !== "biometricos" && kind !== "firmas")) continue;
    const key = `${id}:${kind}`;
    if (seenCancelled.has(key)) continue;
    seenCancelled.add(key);
    const cur = out.get(id) ?? emptyHints();
    if (kind === "biometricos") {
      out.set(id, {
        ...cur,
        agendaBiometricos: {
          ...cur.agendaBiometricos,
          hasLastCancelledBooking: true,
        },
      });
    } else {
      out.set(id, {
        ...cur,
        agendaFirmas: {
          ...cur.agendaFirmas,
          hasLastCancelledBooking: true,
        },
      });
    }
  }

  return out;
}
