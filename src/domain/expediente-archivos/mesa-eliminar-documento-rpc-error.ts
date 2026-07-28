import { ExpedienteArchivosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `mesa_eliminar_documento_expediente`. */
export function mapMesaEliminarDocumentoRpcError(error: {
  message?: string;
  code?: string;
}): ExpedienteArchivosSupabaseError {
  const msg = String(error.message ?? "").toLowerCase();
  if (msg.includes("no autenticado") || msg.includes("perfil no encontrado")) {
    return new ExpedienteArchivosSupabaseError(
      "Tu sesión expiró. Vuelve a iniciar sesión e intenta de nuevo.",
    );
  }
  if (msg.includes("rol no autorizado")) {
    return new ExpedienteArchivosSupabaseError(
      "No tienes permiso para eliminar este documento.",
    );
  }
  if (msg.includes("fuera de la organización")) {
    return new ExpedienteArchivosSupabaseError(
      "No puedes operar expedientes de otra organización.",
    );
  }
  if (msg.includes("tipo_documento no permitido")) {
    return new ExpedienteArchivosSupabaseError(
      "Este tipo de documento no se puede eliminar desde Mesa.",
    );
  }
  if (msg.includes("ciclo activo") || msg.includes("no disponible")) {
    return new ExpedienteArchivosSupabaseError(
      "El expediente no está disponible para esta operación.",
    );
  }
  if (msg.includes("aún no fue enviado")) {
    return new ExpedienteArchivosSupabaseError(
      "El expediente aún no fue enviado a Mesa.",
    );
  }
  return new ExpedienteArchivosSupabaseError(
    "No se pudo eliminar el documento. Intenta de nuevo.",
  );
}
