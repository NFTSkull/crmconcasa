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

/** P3H.1: lectura RLS de `expediente_documentos`; escritura pendiente P3H.2. */
export class SupabaseExpedienteArchivosRepo implements ExpedienteArchivosRepo {
  private unsupportedWrite(): never {
    throw new ExpedienteArchivosSupabaseError(
      "La carga real de documentos se conectará en P3H.2.",
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

  async uploadArchivo(params: UploadArchivoParams): Promise<void> {
    void params;
    this.unsupportedWrite();
  }

  async replaceArchivo(params: ReplaceArchivoParams): Promise<void> {
    void params;
    this.unsupportedWrite();
  }

  async getArchivoBlob(id: string): Promise<Blob> {
    void id;
    this.unsupportedWrite();
  }

  async updateRevision(id: string, patch: UpdateRevisionPatch): Promise<void> {
    void id;
    void patch;
    this.unsupportedWrite();
  }
}
