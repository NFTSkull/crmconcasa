import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { ExpedientesSupabaseError } from "./supabase.error";
import { isPostgrestFunctionMissing } from "./postgrest-function-missing";
import {
  P189_INFONAVIT_FEATURE_OFF,
  parseP189InfonavitFeatureStatus,
  type P189InfonavitFeatureStatus,
} from "./p189-infonavit-feature";

export async function fetchP189InfonavitFeatureStatus(
  expedienteId: string,
): Promise<P189InfonavitFeatureStatus> {
  const idNorm = String(expedienteId).trim();
  if (!idNorm) {
    throw new ExpedientesSupabaseError("No se pudo consultar el estado P189.");
  }
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedientesSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();
  if (sessionError || !session?.user) {
    throw new ExpedientesSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }
  const { data, error } = await supabaseBrowser.rpc(
    "get_p189_infonavit_feature_status",
    { p_expediente_id: idNorm },
  );
  if (error) {
    if (isPostgrestFunctionMissing(error)) {
      return { ...P189_INFONAVIT_FEATURE_OFF };
    }
    throw new ExpedientesSupabaseError(
      "No se pudo consultar el estado de documentos INFONAVIT.",
    );
  }
  return parseP189InfonavitFeatureStatus(data);
}
