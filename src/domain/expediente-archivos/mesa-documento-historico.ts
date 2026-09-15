"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";
import { EXPEDIENTE_DOCUMENTOS_BUCKET } from "./upload-constraints";

/**
 * Lectura exclusiva de Mesa para una versión documental reemplazada.
 * La RPC valida rol/organización/visibilidad; no reactiva ni modifica la fila histórica.
 */
export async function getMesaDocumentoHistoricoBlob(documentoId: string): Promise<Blob> {
  const id = String(documentoId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ExpedienteArchivosSupabaseError("Documento histórico inválido.");
  }
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedienteArchivosSupabaseError(
      "Supabase no está configurado. Intenta de nuevo más tarde.",
    );
  }

  const client = supabaseBrowser;
  const { data: storagePathData, error: pathError } = await client.rpc(
    "mesa_get_documento_historico_storage_path",
    { p_documento_id: id },
  );

  const storagePath =
    typeof storagePathData === "string" ? storagePathData.trim() : "";
  if (pathError || !storagePath) {
    throw new ExpedienteArchivosSupabaseError(
      "No se pudo abrir la versión anterior. Verifica tu acceso o intenta de nuevo.",
    );
  }

  const { data, error } = await client.storage
    .from(EXPEDIENTE_DOCUMENTOS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new ExpedienteArchivosSupabaseError(
      "No se pudo descargar la versión anterior. Intenta de nuevo.",
    );
  }

  return data;
}
