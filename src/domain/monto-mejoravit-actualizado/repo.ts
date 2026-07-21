"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  mapActualizarMontoMejoravitResult,
  mapExpedienteMontoMejoravitContext,
  MontoMejoravitContextParseError,
} from "./map-context";
import {
  mapMontoMejoravitRpcError,
  MontoMejoravitSupabaseError,
} from "./rpc-error";
import type {
  ActualizarMontoMejoravitMesaParams,
  ActualizarMontoMejoravitMesaResult,
  ExpedienteMontoMejoravitContext,
} from "./types";

export { MontoMejoravitSupabaseError };

export function buildGetMontoMejoravitContextRpcArgs(
  expedienteId: string,
): Readonly<{ p_expediente_id: string }> {
  return { p_expediente_id: expedienteId };
}

export function buildActualizarMontoMejoravitRpcArgs(
  params: ActualizarMontoMejoravitMesaParams,
): Readonly<{
  p_expediente_id: string;
  p_monto_nuevo: number;
  p_motivo: string;
}> {
  return {
    p_expediente_id: params.expedienteId,
    p_monto_nuevo: params.montoNuevo,
    p_motivo: params.motivo,
  };
}

async function requireSessionClient() {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new MontoMejoravitSupabaseError("Supabase no está configurado.");
  }
  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();
  if (sessionError || !session?.user) {
    throw new MontoMejoravitSupabaseError("No hay sesión activa.");
  }
  return supabaseBrowser;
}

export async function getExpedienteMontoMejoravitContext(
  expedienteId: string,
): Promise<ExpedienteMontoMejoravitContext> {
  const id = expedienteId.trim();
  if (!id) {
    throw new MontoMejoravitSupabaseError("expediente_id es obligatorio.");
  }

  const client = await requireSessionClient();
  const { data, error } = await client.rpc(
    "get_expediente_monto_mejoravit_context",
    buildGetMontoMejoravitContextRpcArgs(id),
  );

  if (error) {
    throw mapMontoMejoravitRpcError(error);
  }

  try {
    return mapExpedienteMontoMejoravitContext(data);
  } catch (err) {
    if (err instanceof MontoMejoravitContextParseError) {
      throw new MontoMejoravitSupabaseError(err.message);
    }
    throw err;
  }
}

export async function actualizarMontoMejoravitMesa(
  params: ActualizarMontoMejoravitMesaParams,
): Promise<ActualizarMontoMejoravitMesaResult> {
  const expedienteId = params.expedienteId.trim();
  if (!expedienteId) {
    throw new MontoMejoravitSupabaseError("expediente_id es obligatorio.");
  }

  const client = await requireSessionClient();
  const { data, error } = await client.rpc(
    "mesa_actualizar_monto_mejoravit",
    buildActualizarMontoMejoravitRpcArgs({
      expedienteId,
      montoNuevo: params.montoNuevo,
      motivo: params.motivo,
    }),
  );

  if (error) {
    throw mapMontoMejoravitRpcError(error);
  }

  try {
    return mapActualizarMontoMejoravitResult(data);
  } catch (err) {
    if (err instanceof MontoMejoravitContextParseError) {
      throw new MontoMejoravitSupabaseError(err.message);
    }
    throw err;
  }
}
