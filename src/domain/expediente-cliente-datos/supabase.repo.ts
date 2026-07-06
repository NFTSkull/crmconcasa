"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { ExpedienteClienteDatosRepo } from "./repo";
import type {
  ExpedienteClienteDatos,
  SaveExpedienteClienteDatosInput,
  UpdateEstadoExpedienteClienteDatosInput,
} from "./types";
import {
  buildSaveClienteDatosRpcPayload,
  mapSupabaseRowToExpedienteClienteDatos,
  type SupabaseClienteDatosRow,
} from "./map-supabase-cliente-datos";
import { mapSaveClienteDatosRpcError } from "./save-cliente-datos-rpc-error";
import { mapSaveClienteDatosCorreccionRpcError } from "./save-cliente-datos-correccion-rpc-error";
import { mapUpdateClienteDatosRevisionRpcError } from "./update-cliente-datos-revision-rpc-error";
import { ClienteDatosSupabaseError } from "./supabase.error";
import { emitExpedienteClienteDatosUpdated } from "./emit-updated";
import type { ExpedienteClienteDatosEstado } from "./types";

const CLIENTE_DATOS_SELECT = `
  expediente_id,
  datos,
  estado,
  comentario_rechazo,
  validated_at,
  validated_by,
  rejected_at,
  rejected_by,
  updated_at,
  referencias,
  imagenes,
  telefono_normalizado,
  porcentaje_cobro,
  monto_calculado,
  metodo_pago,
  updated_by_profile:profiles!cliente_datos_updated_by_fkey ( email ),
  validated_by_profile:profiles!cliente_datos_validated_by_fkey ( email ),
  rejected_by_profile:profiles!cliente_datos_rejected_by_fkey ( email )
`;

async function requireSupabaseSession(): Promise<{
  client: SupabaseClient;
}> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ClienteDatosSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user) {
    throw new ClienteDatosSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }

  return { client };
}

/** P3G: lectura RLS + guardado vía RPC `save_cliente_datos`. P3J.4: revisión Mesa vía `update_cliente_datos_revision`. */
export class SupabaseExpedienteClienteDatosRepo implements ExpedienteClienteDatosRepo {
  async getByExpedienteId(expedienteId: string): Promise<ExpedienteClienteDatos | null> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) return null;

    const { client } = await requireSupabaseSession();

    const { data, error } = await client
      .from("cliente_datos")
      .select(CLIENTE_DATOS_SELECT)
      .eq("expediente_id", idNorm)
      .maybeSingle();

    if (error) {
      throw new ClienteDatosSupabaseError(
        "No se pudieron cargar los datos del cliente. Intenta de nuevo más tarde.",
      );
    }

    if (!data) return null;

    return mapSupabaseRowToExpedienteClienteDatos(data as SupabaseClienteDatosRow);
  }

  async listEstadoByExpedienteIds(
    expedienteIds: readonly string[],
  ): Promise<Record<string, ExpedienteClienteDatosEstado>> {
    const ids = [
      ...new Set(expedienteIds.map((id) => String(id).trim()).filter(Boolean)),
    ];
    if (ids.length === 0) return {};

    const { client } = await requireSupabaseSession();
    const { data, error } = await client
      .from("cliente_datos")
      .select("expediente_id, estado")
      .in("expediente_id", ids);

    if (error) {
      throw new ClienteDatosSupabaseError(
        "No se pudieron cargar los estados de datos del cliente.",
      );
    }

    const out: Record<string, ExpedienteClienteDatosEstado> = {};
    for (const row of data ?? []) {
      const expId = String((row as { expediente_id?: unknown }).expediente_id ?? "").trim();
      const estado = (row as { estado?: unknown }).estado;
      if (
        !expId ||
        (estado !== "pendiente" &&
          estado !== "completo" &&
          estado !== "validado" &&
          estado !== "rechazado")
      ) {
        continue;
      }
      out[expId] = estado;
    }
    return out;
  }

  async save(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos> {
    const idNorm = String(input.expedienteId).trim();
    if (!idNorm) {
      throw new ClienteDatosSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();
    const rpcArgs = buildSaveClienteDatosRpcPayload(
      idNorm,
      input.datos,
      input.direccionOpcional,
      input.programaDb,
    );

    const { error } = await client.rpc("save_cliente_datos", rpcArgs);

    if (error) {
      throw mapSaveClienteDatosRpcError(error);
    }

    const saved = await this.getByExpedienteId(idNorm);
    if (!saved) {
      throw new ClienteDatosSupabaseError(
        "Los datos se guardaron pero no pudieron recargarse. Actualiza la página.",
      );
    }

    emitExpedienteClienteDatosUpdated(idNorm);

    return {
      ...saved,
      updatedBy: input.updatedBy || saved.updatedBy,
    };
  }

  async saveCorreccion(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos> {
    const idNorm = String(input.expedienteId).trim();
    if (!idNorm) {
      throw new ClienteDatosSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();
    const rpcArgs = buildSaveClienteDatosRpcPayload(
      idNorm,
      input.datos,
      input.direccionOpcional,
      input.programaDb,
    );
    const { p_estado: _omit, ...correccionArgs } = rpcArgs;

    const { error } = await client.rpc("save_cliente_datos_correccion", correccionArgs);

    if (error) {
      throw mapSaveClienteDatosCorreccionRpcError(error);
    }

    const saved = await this.getByExpedienteId(idNorm);
    if (!saved) {
      throw new ClienteDatosSupabaseError(
        "Los datos se guardaron pero no pudieron recargarse. Actualiza la página.",
      );
    }

    emitExpedienteClienteDatosUpdated(idNorm);

    return {
      ...saved,
      updatedBy: input.updatedBy || saved.updatedBy,
    };
  }

  async updateEstado(
    input: UpdateEstadoExpedienteClienteDatosInput,
  ): Promise<ExpedienteClienteDatos | null> {
    const idNorm = String(input.expedienteId).trim();
    if (!idNorm) {
      throw new ClienteDatosSupabaseError("El identificador del expediente es obligatorio.");
    }

    if (input.estado !== "validado" && input.estado !== "rechazado") {
      throw new ClienteDatosSupabaseError("Solo se puede validar o rechazar datos generales.");
    }

    if (
      input.estado === "rechazado" &&
      (!input.comentarioRechazo || input.comentarioRechazo.trim() === "")
    ) {
      throw new ClienteDatosSupabaseError(
        "Debes indicar un motivo de rechazo antes de guardar.",
      );
    }

    const { client } = await requireSupabaseSession();

    const { error } = await client.rpc("update_cliente_datos_revision", {
      p_expediente_id: idNorm,
      p_estado: input.estado,
      p_comentario_rechazo:
        input.estado === "rechazado" ? input.comentarioRechazo?.trim() ?? null : null,
    });

    if (error) {
      throw mapUpdateClienteDatosRevisionRpcError(error);
    }

    emitExpedienteClienteDatosUpdated(idNorm);

    return this.getByExpedienteId(idNorm);
  }
}
