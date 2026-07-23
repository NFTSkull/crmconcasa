import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  agendaSlotCapacityRowSchema,
  mapAgendaSlotCapacityRow,
  upsertAgendaSlotCapacityResultSchema,
  type AgendaSlotCapacity,
  type AgendaSlotCapacityKind,
  type UpsertAgendaSlotCapacityInput,
  type UpsertAgendaSlotCapacityResult,
} from "./types";

export class AgendaSlotCapacitiesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgendaSlotCapacitiesError";
  }
}

function requireClient() {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AgendaSlotCapacitiesError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabaseBrowser;
}

export async function listAgendaSlotCapacities(params: {
  kind: AgendaSlotCapacityKind;
  slotDate: string;
  locationId?: string | null;
}): Promise<AgendaSlotCapacity[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("list_agenda_slot_capacities", {
    p_kind: params.kind,
    p_slot_date: params.slotDate,
    p_location_id: params.locationId?.trim() || null,
  });

  if (error) {
    const msg = error.message ?? "";
    if (/no autenticado|sesión/i.test(msg)) {
      throw new AgendaSlotCapacitiesError("Tu sesión expiró. Inicia sesión nuevamente.");
    }
    if (/no autorizado|rol/i.test(msg)) {
      throw new AgendaSlotCapacitiesError("No tienes permiso para consultar cupos de agenda.");
    }
    throw new AgendaSlotCapacitiesError("No se pudieron cargar los cupos por horario.");
  }

  const parsed = z.array(agendaSlotCapacityRowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new AgendaSlotCapacitiesError("La respuesta de cupos no es válida.");
  }
  return parsed.data.map(mapAgendaSlotCapacityRow);
}

export async function upsertAgendaSlotCapacity(
  input: UpsertAgendaSlotCapacityInput,
): Promise<UpsertAgendaSlotCapacityResult> {
  const client = requireClient();
  const { data, error } = await client.rpc("upsert_agenda_slot_capacity", {
    p_kind: input.kind,
    p_location_id: input.locationId.trim(),
    p_slot_date: input.slotDate,
    p_slot_time: input.slotTime,
    p_capacity: input.capacity,
    p_active: input.active,
  });

  if (error) {
    const msg = error.message ?? "";
    if (/capacidad.*ocupados|menor que ocupados/i.test(msg)) {
      throw new AgendaSlotCapacitiesError(
        "La capacidad no puede ser menor que los lugares ya ocupados.",
      );
    }
    if (/rol no autorizado/i.test(msg)) {
      throw new AgendaSlotCapacitiesError("Solo Mesa Admin puede definir cupos por horario.");
    }
    if (/sede obligatoria|fecha\/hora|capacidad debe/i.test(msg)) {
      throw new AgendaSlotCapacitiesError("Revisa sede, fecha, hora y capacidad (> 0).");
    }
    throw new AgendaSlotCapacitiesError("No se pudo guardar el cupo por horario.");
  }

  const parsed = upsertAgendaSlotCapacityResultSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AgendaSlotCapacitiesError("La respuesta al guardar el cupo no es válida.");
  }
  return parsed.data;
}
