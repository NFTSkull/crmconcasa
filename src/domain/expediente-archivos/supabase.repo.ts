"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type {
  ExpedienteArchivoResumen,
  TipoDocumentoCatalogo,
} from "./types";
import { TIPO_DOCUMENTO_CATALOGO } from "./types";
import type {
  ExpedienteArchivosRepo,
  ReplaceArchivoParams,
  UpdateRevisionPatch,
  UploadArchivoParams,
} from "./repo";
import {
  mapSupabaseRowToExpedienteArchivoListItem,
  type SupabaseExpedienteDocumentoRow,
} from "./map-supabase-expediente-documentos";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";
import { mapRegisterExpedienteDocumentoRpcError } from "./register-expediente-documento-rpc-error";
import { buildExpedienteDocumentoStoragePath } from "./storage-path";
import {
  EXPEDIENTE_DOCUMENTOS_BUCKET,
  validateExpedienteDocumentoFile,
} from "./upload-constraints";

const DOCUMENTOS_SELECT = `
  id,
  expediente_id,
  tipo_documento,
  nombre_original,
  mime_type,
  size_bytes,
  estatus_revision,
  comentario_mesa,
  uploaded_by_role,
  created_at,
  uploaded_by_profile:profiles!expediente_documentos_uploaded_by_fkey ( email )
`;

async function requireSupabaseSession(): Promise<{ client: SupabaseClient }> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedienteArchivosSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user) {
    throw new ExpedienteArchivosSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }

  return { client };
}

async function fetchExpedienteUploadContext(
  client: SupabaseClient,
  expedienteId: string,
): Promise<{ organizationId: string; submittedToMesa: boolean }> {
  const { data, error } = await client
    .from("expedientes")
    .select("organization_id, submitted_to_mesa")
    .eq("id", expedienteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data?.organization_id) {
    throw new ExpedienteArchivosSupabaseError(
      "No se pudo validar el expediente para subir documentos.",
    );
  }

  return {
    organizationId: String(data.organization_id),
    submittedToMesa: Boolean(data.submitted_to_mesa),
  };
}

function buildResumenFromList(
  expedienteId: string,
  items: Awaited<ReturnType<SupabaseExpedienteArchivosRepo["listByExpediente"]>>,
): ExpedienteArchivoResumen[] {
  const byTipo = new Map<TipoDocumentoCatalogo, (typeof items)[number]>();
  for (const item of items) {
    byTipo.set(item.tipo_documento, item);
  }

  return TIPO_DOCUMENTO_CATALOGO.map((tipo) => {
    const found = byTipo.get(tipo);
    if (!found) {
      return {
        expediente_id: expedienteId,
        tipo_documento: tipo,
        id: null,
        nombre_original: null,
        mime_type: null,
        size_bytes: null,
        created_at: null,
        uploaded_by_role: null,
        uploaded_by_email: null,
        estatus_revision: "faltante" as const,
        comentario_mesa: null,
      };
    }
    return {
      expediente_id: found.expediente_id,
      tipo_documento: found.tipo_documento,
      id: found.id,
      nombre_original: found.nombre_original,
      mime_type: found.mime_type,
      size_bytes: found.size_bytes,
      created_at: found.created_at,
      uploaded_by_role: found.uploaded_by_role,
      uploaded_by_email: found.uploaded_by_email,
      estatus_revision: found.estatus_revision,
      comentario_mesa: found.comentario_mesa,
    };
  });
}

/** P3H.2: lectura RLS + upload Storage + RPC `register_expediente_documento`. */
export class SupabaseExpedienteArchivosRepo implements ExpedienteArchivosRepo {
  private unsupportedReadBlob(): never {
    throw new ExpedienteArchivosSupabaseError(
      "La descarga/preview de documentos se conectará en una fase posterior.",
    );
  }

  async listByExpediente(expedienteId: string) {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) return [];

    const { client } = await requireSupabaseSession();

    const { data, error } = await client
      .from("expediente_documentos")
      .select(DOCUMENTOS_SELECT)
      .eq("expediente_id", idNorm);

    if (error) {
      throw new ExpedienteArchivosSupabaseError(
        "No se pudieron cargar los documentos del expediente. Intenta de nuevo más tarde.",
      );
    }

    const rows = (data ?? []) as SupabaseExpedienteDocumentoRow[];
    const mapped = rows
      .map((row) => mapSupabaseRowToExpedienteArchivoListItem(row))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return mapped;
  }

  async listResumenByExpediente(expedienteId: string): Promise<ExpedienteArchivoResumen[]> {
    const items = await this.listByExpediente(expedienteId);
    return buildResumenFromList(expedienteId, items);
  }

  private async uploadOrReplace(params: UploadArchivoParams): Promise<void> {
    const expedienteId = String(params.expedienteId).trim();
    const tipo = params.tipo_documento;
    if (!expedienteId) {
      throw new ExpedienteArchivosSupabaseError("Expediente inválido para subir documento.");
    }

    const validation = validateExpedienteDocumentoFile(params.file);
    if (!validation.ok) {
      throw new ExpedienteArchivosSupabaseError(validation.message);
    }

    const { client } = await requireSupabaseSession();
    const ctx = await fetchExpedienteUploadContext(client, expedienteId);

    if (ctx.submittedToMesa) {
      throw new ExpedienteArchivosSupabaseError(
        "No puedes subir documentos: el expediente ya fue enviado a Mesa.",
      );
    }

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
      throw new ExpedienteArchivosSupabaseError(
        uploadError.message?.toLowerCase().includes("bucket")
          ? "No se pudo acceder al almacenamiento de documentos. Contacta soporte."
          : "No se pudo subir el archivo. Verifica el formato (PDF/JPG/PNG) y el tamaño (máx. 15 MB).",
      );
    }

    try {
      const { error: rpcError } = await client.rpc("register_expediente_documento", {
        p_expediente_id: expedienteId,
        p_tipo_documento: tipo,
        p_storage_path: storagePath,
        p_nombre_original: params.file.name,
        p_mime_type: params.file.type,
        p_size_bytes: params.file.size,
      });

      if (rpcError) {
        throw mapRegisterExpedienteDocumentoRpcError(rpcError);
      }
    } catch (err) {
      await client.storage
        .from(EXPEDIENTE_DOCUMENTOS_BUCKET)
        .remove([storagePath])
        .catch(() => undefined);
      if (err instanceof ExpedienteArchivosSupabaseError) {
        throw err;
      }
      throw new ExpedienteArchivosSupabaseError(
        "No se pudo registrar el documento después de subirlo. Intenta de nuevo.",
      );
    }
  }

  async uploadArchivo(params: UploadArchivoParams): Promise<void> {
    await this.uploadOrReplace(params);
  }

  async replaceArchivo(params: ReplaceArchivoParams): Promise<void> {
    await this.uploadOrReplace(params);
  }

  async getArchivoBlob(id: string): Promise<Blob> {
    void id;
    this.unsupportedReadBlob();
  }

  async updateRevision(id: string, patch: UpdateRevisionPatch): Promise<void> {
    void id;
    void patch;
    throw new ExpedienteArchivosSupabaseError(
      "La revisión de documentos la realiza Mesa de control.",
    );
  }
}
