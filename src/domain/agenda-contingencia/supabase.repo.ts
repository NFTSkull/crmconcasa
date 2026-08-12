/**
 * P172 B2 — repo Supabase (preview + listados + declarar/rebook).
 */
import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  mapAgendarExtraordinariaRpcError,
  mapDeclararContingenciaRpcError,
  AgendaContingenciaError,
} from "./rpc-errors";
import {
  agendarCitaExtraordinariaInputSchema,
  agendarCitaExtraordinariaResultSchema,
  contingenciaPendienteItemSchema,
  declararContingenciaInputSchema,
  declararContingenciaResultSchema,
  type AgendarCitaExtraordinariaInput,
  type AgendarCitaExtraordinariaResult,
  type ContingenciaPendienteItem,
  type DeclararContingenciaInput,
  type DeclararContingenciaResult,
} from "./types";
import {
  asesorContingenciaExpedienteItemSchema,
  contingenciaPreviewResultSchema,
  mesaContingenciaHeaderSchema,
  mesaContingenciaItemSchema,
  type AsesorContingenciaExpedienteItem,
  type ContingenciaPreviewResult,
  type MesaContingenciaHeader,
  type MesaContingenciaItem,
} from "./b2-types";

function requireClient() {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AgendaContingenciaError(
      "NOT_CONFIGURED",
      "Supabase no está configurado.",
    );
  }
  return supabaseBrowser;
}

export async function declararContingencia(
  input: DeclararContingenciaInput,
): Promise<DeclararContingenciaResult> {
  const parsed = declararContingenciaInputSchema.parse(input);
  const sb = requireClient();
  const { data, error } = await sb.rpc("agenda_declarar_contingencia", {
    p_affected_date: parsed.affected_date,
    p_kind: parsed.kind,
    p_location_id: parsed.location_id ?? null,
    p_reason: parsed.reason,
  });
  if (error) throw mapDeclararContingenciaRpcError(error);
  return declararContingenciaResultSchema.parse(data);
}

export async function previewContingencia(input: {
  affected_date: string;
  kind: "biometricos" | "firmas";
  location_id?: string | null;
}): Promise<ContingenciaPreviewResult> {
  const sb = requireClient();
  const { data, error } = await sb.rpc("agenda_preview_contingencia", {
    p_affected_date: input.affected_date,
    p_kind: input.kind,
    p_location_id: input.location_id ?? null,
  });
  if (error) throw mapDeclararContingenciaRpcError(error);
  return contingenciaPreviewResultSchema.parse(data);
}

export async function listMesaAgendaContingencias(input: {
  from?: string | null;
  to?: string | null;
}): Promise<MesaContingenciaHeader[]> {
  const sb = requireClient();
  const { data, error } = await sb.rpc("mesa_list_agenda_contingencias", {
    p_from: input.from ?? null,
    p_to: input.to ?? null,
  });
  if (error) throw mapDeclararContingenciaRpcError(error);
  const items = (data as { items?: unknown } | null)?.items ?? [];
  return z.array(mesaContingenciaHeaderSchema).parse(items);
}

export async function listMesaContingenciaItems(input: {
  from?: string | null;
  to?: string | null;
}): Promise<MesaContingenciaItem[]> {
  const sb = requireClient();
  const { data, error } = await sb.rpc("mesa_list_contingencia_items", {
    p_from: input.from ?? null,
    p_to: input.to ?? null,
  });
  if (error) throw mapDeclararContingenciaRpcError(error);
  const items = (data as { items?: unknown } | null)?.items ?? [];
  return z.array(mesaContingenciaItemSchema).parse(items);
}

export async function agendarCitaExtraordinaria(
  input: AgendarCitaExtraordinariaInput,
): Promise<AgendarCitaExtraordinariaResult> {
  const parsed = agendarCitaExtraordinariaInputSchema.parse(input);
  const sb = requireClient();
  const { data, error } = await sb.rpc("asesor_agendar_cita_extraordinaria", {
    p_contingency_item_id: parsed.contingency_item_id,
    p_booking_date: parsed.booking_date,
    p_booking_time: parsed.booking_time,
    p_location_id: parsed.location_id,
  });
  if (error) throw mapAgendarExtraordinariaRpcError(error);
  return agendarCitaExtraordinariaResultSchema.parse(data);
}

export async function listContingenciaPendientesAsesor(): Promise<
  ContingenciaPendienteItem[]
> {
  const sb = requireClient();
  const { data, error } = await sb.rpc("asesor_list_contingencia_pendientes");
  if (error) throw mapAgendarExtraordinariaRpcError(error);
  const items = (data as { items?: unknown } | null)?.items ?? [];
  return z.array(contingenciaPendienteItemSchema).parse(items);
}

export async function listContingenciaExpedienteAsesor(
  expedienteId: string,
): Promise<AsesorContingenciaExpedienteItem[]> {
  const sb = requireClient();
  const { data, error } = await sb.rpc("asesor_list_contingencia_expediente", {
    p_expediente_id: expedienteId,
  });
  if (error) throw mapAgendarExtraordinariaRpcError(error);
  const items = (data as { items?: unknown } | null)?.items ?? [];
  return z.array(asesorContingenciaExpedienteItemSchema).parse(items);
}

/** Index items by original booking id for Mesa row badges. */
export function indexContingenciaItemsByBookingId(
  items: readonly MesaContingenciaItem[],
): ReadonlyMap<string, MesaContingenciaItem> {
  const map = new Map<string, MesaContingenciaItem>();
  for (const it of items) {
    map.set(it.original_booking_id, it);
  }
  return map;
}
