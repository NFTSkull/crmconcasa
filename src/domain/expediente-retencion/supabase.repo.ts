"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { RetencionTipoDocumento } from "@/domain/expediente-archivos/retencion-acuse-aviso";
import { buildExpedienteDocumentoStoragePath } from "@/domain/expediente-archivos/storage-path";
import {
  EXPEDIENTE_DOCUMENTOS_BUCKET,
  validateExpedienteDocumentoFile,
} from "@/domain/expediente-archivos/upload-constraints";
import { ExpedienteRetencionSupabaseError } from "./supabase.error";
import { mapRegisterRetencionDocRpcError } from "./register-retencion-doc-rpc-error";
import { mapEnviarRetencionMesaRpcError } from "./enviar-retencion-mesa-rpc-error";
import type {
  ExpedienteRetencionEnvioMesa,
  ExpedienteRetencionOpcion,
  RetencionOpcion,
} from "./types";

const RETENCION_OPCION_SELECT = `
  expediente_id,
  retencion_opcion,
  updated_at
`;

const RETENCION_ENVIO_SELECT = `
  expediente_id,
  enviado,
  fecha_envio_mesa,
  opcion,
  estado
`;

type RetencionOpcionRow = Readonly<{
  expediente_id: string;
  retencion_opcion: RetencionOpcion;
  updated_at: string;
}>;

type RetencionEnvioRow = Readonly<{
  expediente_id: string;
  enviado: boolean;
  fecha_envio_mesa: string;
  opcion: RetencionOpcion;
  estado: "enviado" | "correccion_requerida";
}>;

export function mapSupabaseRetencionOpcionRow(
  row: RetencionOpcionRow,
): ExpedienteRetencionOpcion {
  return {
    expedienteId: String(row.expediente_id),
    retencion_opcion: row.retencion_opcion,
    updatedAt: String(row.updated_at),
  };
}

export function mapSupabaseRetencionEnvioRow(
  row: RetencionEnvioRow,
): ExpedienteRetencionEnvioMesa {
  return {
    expedienteId: String(row.expediente_id),
    enviado: Boolean(row.enviado),
    fechaEnvioMesa: String(row.fecha_envio_mesa),
    opcion: row.opcion,
    estado: row.estado,
  };
}

async function requireSupabaseSession(): Promise<{ client: SupabaseClient }> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedienteRetencionSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user) {
    throw new ExpedienteRetencionSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }

  return { client };
}

async function fetchExpedienteRetencionUploadContext(
  client: SupabaseClient,
  expedienteId: string,
): Promise<{ organizationId: string }> {
  const { data, error } = await client
    .from("expedientes")
    .select("organization_id, submitted_to_mesa, etapa_actual, subestado, ciclo_estado")
    .eq("id", expedienteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data?.organization_id) {
    throw new ExpedienteRetencionSupabaseError(
      "No se pudo validar el expediente para subir documentos de retención.",
    );
  }

  if (!data.submitted_to_mesa) {
    throw new ExpedienteRetencionSupabaseError(
      "Los documentos de retención solo se suben después de que el expediente fue enviado a Mesa.",
    );
  }

  return { organizationId: String(data.organization_id) };
}

/** P3O.2: retención etapa 8 asesor — lectura tablas + Storage/RPC upload + envío Mesa. */
export class ExpedienteRetencionSupabaseRepo {
  async getOpcionByExpedienteId(
    expedienteId: string,
  ): Promise<ExpedienteRetencionOpcion | null> {
    const id = String(expedienteId).trim();
    if (!id) return null;

    const { client } = await requireSupabaseSession();
    const { data, error } = await client
      .from("retencion_opciones")
      .select(RETENCION_OPCION_SELECT)
      .eq("expediente_id", id)
      .maybeSingle();

    if (error) {
      throw new ExpedienteRetencionSupabaseError(
        "No se pudo cargar la opción de retención del expediente.",
      );
    }

    if (!data?.retencion_opcion) return null;
    return mapSupabaseRetencionOpcionRow(data as RetencionOpcionRow);
  }

  async getEnvioByExpedienteId(
    expedienteId: string,
  ): Promise<ExpedienteRetencionEnvioMesa | null> {
    const id = String(expedienteId).trim();
    if (!id) return null;

    const { client } = await requireSupabaseSession();
    const { data, error } = await client
      .from("retencion_envios")
      .select(RETENCION_ENVIO_SELECT)
      .eq("expediente_id", id)
      .maybeSingle();

    if (error) {
      throw new ExpedienteRetencionSupabaseError(
        "No se pudo cargar el estado de envío de retención.",
      );
    }

    if (!data?.expediente_id) return null;
    return mapSupabaseRetencionEnvioRow(data as RetencionEnvioRow);
  }

  async uploadRetencionDocumento(params: {
    expedienteId: string;
    tipo_documento: RetencionTipoDocumento;
    file: File;
  }): Promise<void> {
    const expedienteId = String(params.expedienteId).trim();
    const tipo = params.tipo_documento;
    if (!expedienteId) {
      throw new ExpedienteRetencionSupabaseError("Expediente inválido para subir documento.");
    }

    const validation = validateExpedienteDocumentoFile(params.file);
    if (!validation.ok) {
      throw new ExpedienteRetencionSupabaseError(validation.message);
    }

    const { client } = await requireSupabaseSession();
    const ctx = await fetchExpedienteRetencionUploadContext(client, expedienteId);

    const storagePath = buildExpedienteDocumentoStoragePath({
      organizationId: ctx.organizationId,
      expedienteId,
      tipoDocumento: tipo,
      originalFileName: params.file.name,
    });

    const { error: uploadError } = await client.storage
      .from(EXPEDIENTE_DOCUMENTOS_BUCKET)
      .upload(storagePath, params.file, {
        contentType: params.file.type,
        upsert: false,
      });

    if (uploadError) {
      throw new ExpedienteRetencionSupabaseError(
        uploadError.message?.toLowerCase().includes("bucket")
          ? "No se pudo acceder al almacenamiento de documentos. Contacta soporte."
          : "No se pudo subir el archivo. Verifica el formato (solo PDF) y el tamaño (máx. 15 MB).",
      );
    }

    try {
      const { error: rpcError } = await client.rpc("register_expediente_documento_retencion", {
        p_expediente_id: expedienteId,
        p_tipo_documento: tipo,
        p_storage_path: storagePath,
        p_nombre_original: params.file.name,
        p_mime_type: params.file.type,
        p_size_bytes: params.file.size,
      });

      if (rpcError) {
        throw mapRegisterRetencionDocRpcError(rpcError);
      }
    } catch (err) {
      await client.storage
        .from(EXPEDIENTE_DOCUMENTOS_BUCKET)
        .remove([storagePath])
        .catch(() => undefined);
      if (err instanceof ExpedienteRetencionSupabaseError) {
        throw err;
      }
      throw new ExpedienteRetencionSupabaseError(
        "No se pudo registrar el documento después de subirlo. Intenta de nuevo.",
      );
    }
  }

  async enviarRetencionAMesa(params: {
    expedienteId: string;
    retencion_opcion: RetencionOpcion;
  }): Promise<ExpedienteRetencionEnvioMesa> {
    const expedienteId = String(params.expedienteId).trim();
    if (!expedienteId) {
      throw new ExpedienteRetencionSupabaseError("Expediente inválido para enviar retención.");
    }

    const { client } = await requireSupabaseSession();
    const { error: rpcError } = await client.rpc("enviar_retencion_mesa", {
      p_expediente_id: expedienteId,
      p_retencion_opcion: params.retencion_opcion,
    });

    if (rpcError) {
      throw mapEnviarRetencionMesaRpcError(rpcError);
    }

    const envio = await this.getEnvioByExpedienteId(expedienteId);
    if (!envio) {
      throw new ExpedienteRetencionSupabaseError(
        "Retención enviada pero no se pudo recargar el estado. Actualiza la página.",
      );
    }
    return envio;
  }
}
