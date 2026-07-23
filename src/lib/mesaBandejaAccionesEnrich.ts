/**
 * Batch secundario P119: bookings activos + retención + marcadores (sin N+1).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetencionOpcion } from "@/domain/expediente-retencion/types";
import type { MesaExpedienteMarcador } from "@/domain/expediente-mesa-marcadores";

export type MesaBandejaActiveBookingFlags = Readonly<{
  biometricos: boolean;
  firmas: boolean;
  notificacion: boolean;
}>;

export type MesaBandejaRetencionHint = Readonly<{
  opcion: RetencionOpcion | null;
  enviadoAMesa: boolean;
  envioEstado: "enviado" | "correccion_requerida" | null;
}>;

export async function listActiveBookingFlagsByExpedienteIds(
  client: SupabaseClient,
  expedienteIds: readonly string[],
): Promise<Map<string, MesaBandejaActiveBookingFlags>> {
  const unique = [...new Set(expedienteIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, MesaBandejaActiveBookingFlags>();
  for (const id of unique) {
    out.set(id, { biometricos: false, firmas: false, notificacion: false });
  }
  if (unique.length === 0) return out;

  const { data, error } = await client
    .from("agenda_bookings")
    .select("expediente_id, kind")
    .in("expediente_id", unique)
    .eq("status", "booked")
    .in("kind", ["biometricos", "firmas", "notificacion"]);

  if (error) return out;

  for (const row of data ?? []) {
    const id = String((row as { expediente_id?: string }).expediente_id ?? "").trim();
    const kind = String((row as { kind?: string }).kind ?? "").trim();
    const cur = out.get(id);
    if (!cur || !id) continue;
    if (kind === "biometricos") out.set(id, { ...cur, biometricos: true });
    else if (kind === "firmas") out.set(id, { ...cur, firmas: true });
    else if (kind === "notificacion") out.set(id, { ...cur, notificacion: true });
  }
  return out;
}

export async function listRetencionHintsByExpedienteIds(
  client: SupabaseClient,
  expedienteIds: readonly string[],
): Promise<Map<string, MesaBandejaRetencionHint>> {
  const unique = [...new Set(expedienteIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, MesaBandejaRetencionHint>();
  for (const id of unique) {
    out.set(id, { opcion: null, enviadoAMesa: false, envioEstado: null });
  }
  if (unique.length === 0) return out;

  const [opcionesRes, enviosRes] = await Promise.all([
    client
      .from("retencion_opciones")
      .select("expediente_id, retencion_opcion")
      .in("expediente_id", unique),
    client
      .from("retencion_envios")
      .select("expediente_id, enviado, opcion, estado")
      .in("expediente_id", unique),
  ]);

  for (const row of opcionesRes.data ?? []) {
    const id = String((row as { expediente_id?: string }).expediente_id ?? "").trim();
    const opcion = String(
      (row as { retencion_opcion?: string }).retencion_opcion ?? "",
    ).trim();
    if (!id || (opcion !== "con_sello" && opcion !== "sin_sello")) continue;
    const cur = out.get(id) ?? {
      opcion: null,
      enviadoAMesa: false,
      envioEstado: null,
    };
    out.set(id, { ...cur, opcion });
  }

  for (const row of enviosRes.data ?? []) {
    const id = String((row as { expediente_id?: string }).expediente_id ?? "").trim();
    if (!id) continue;
    const enviado = (row as { enviado?: boolean }).enviado === true;
    const estadoRaw = String((row as { estado?: string }).estado ?? "").trim();
    const estado =
      estadoRaw === "enviado" || estadoRaw === "correccion_requerida"
        ? estadoRaw
        : null;
    const opcionRow = String((row as { opcion?: string }).opcion ?? "").trim();
    const cur = out.get(id) ?? {
      opcion: null,
      enviadoAMesa: false,
      envioEstado: null,
    };
    out.set(id, {
      opcion:
        cur.opcion ??
        (opcionRow === "con_sello" || opcionRow === "sin_sello" ? opcionRow : null),
      enviadoAMesa: enviado,
      envioEstado: estado,
    });
  }

  return out;
}

export async function listTieneDatosMarcadoresByExpedienteIds(
  client: SupabaseClient,
  expedienteIds: readonly string[],
): Promise<Map<string, MesaExpedienteMarcador>> {
  const unique = [...new Set(expedienteIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, MesaExpedienteMarcador>();
  if (unique.length === 0) return out;

  const { data, error } = await client
    .from("expediente_mesa_marcadores")
    .select("expediente_id, tipo, active, updated_at")
    .in("expediente_id", unique)
    .eq("tipo", "tiene_datos")
    .eq("active", true);

  if (error) return out;

  for (const row of data ?? []) {
    const expedienteId = String(
      (row as { expediente_id?: string }).expediente_id ?? "",
    ).trim();
    if (!expedienteId) continue;
    out.set(expedienteId, {
      expedienteId,
      tipo: "tiene_datos",
      active: true,
      updatedAt: String((row as { updated_at?: string }).updated_at ?? ""),
    });
  }
  return out;
}
