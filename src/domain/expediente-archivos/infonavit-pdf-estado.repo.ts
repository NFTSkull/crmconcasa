import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";
import { isPostgrestFunctionMissing } from "@/domain/expedientes/postgrest-function-missing";
import {
  parseInfonavitPdfEstado,
  type InfonavitPdfEstado,
} from "./infonavit-pdf-estado";

const MISSING_RPC_ESTADO: InfonavitPdfEstado = {
  aplica: true,
  has_submission: false,
  submission_version: null,
  submission_kind: null,
  documents: [],
};

export async function fetchExpedienteInfonavitPdfEstado(
  expedienteId: string,
): Promise<InfonavitPdfEstado> {
  const idNorm = String(expedienteId).trim();
  if (!idNorm) {
    throw new ExpedienteArchivosSupabaseError(
      "No se pudo consultar los documentos INFONAVIT.",
    );
  }
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedienteArchivosSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();
  if (sessionError || !session?.user) {
    throw new ExpedienteArchivosSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }
  const { data, error } = await supabaseBrowser.rpc(
    "get_expediente_infonavit_pdf_estado",
    { p_expediente_id: idNorm },
  );
  if (error) {
    if (isPostgrestFunctionMissing(error)) {
      return MISSING_RPC_ESTADO;
    }
    throw new ExpedienteArchivosSupabaseError(
      "No se pudo consultar los documentos INFONAVIT.",
    );
  }
  return parseInfonavitPdfEstado(data);
}
