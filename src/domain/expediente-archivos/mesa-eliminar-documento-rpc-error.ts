import { ExpedienteArchivosSupabaseError } from "./supabase.error";

export type MesaEliminarDocumentoRpcErrorInput = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

/** Log técnico solo en desarrollo; sin URLs firmadas ni secretos. */
export function logMesaEliminarDocumentoRpcErrorDev(
  error: MesaEliminarDocumentoRpcErrorInput,
): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.error("[mesa_eliminar_documento]", {
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

/** Mapea errores de RPC `mesa_eliminar_documento_expediente`. */
export function mapMesaEliminarDocumentoRpcError(
  error: MesaEliminarDocumentoRpcErrorInput,
): ExpedienteArchivosSupabaseError {
  logMesaEliminarDocumentoRpcErrorDev(error);

  const msg = String(error.message ?? "").toLowerCase();
  const details = String(error.details ?? "").toLowerCase();
  const combined = `${msg} ${details}`;

  if (
    combined.includes("no autenticado") ||
    combined.includes("perfil no encontrado")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "Tu sesión expiró. Vuelve a iniciar sesión e intenta de nuevo.",
    );
  }
  if (
    combined.includes("rol no autorizado") ||
    combined.includes("permission denied") ||
    combined.includes("42501")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "No tienes permisos para eliminar este documento.",
    );
  }
  if (combined.includes("fuera de la organización")) {
    return new ExpedienteArchivosSupabaseError(
      "No puedes operar expedientes de otra organización.",
    );
  }
  if (combined.includes("tipo_documento no permitido")) {
    return new ExpedienteArchivosSupabaseError(
      "Este tipo de documento no se puede eliminar desde Mesa.",
    );
  }
  if (
    combined.includes("documento ya no") ||
    combined.includes("no encontrado") ||
    combined.includes("already_absent") ||
    combined.includes("p0002")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "El documento ya no está disponible.",
    );
  }
  if (
    combined.includes("conflicto concurrente") ||
    combined.includes("40001") ||
    combined.includes("could not serialize")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "El documento cambió mientras lo revisabas. Actualiza e intenta nuevamente.",
    );
  }
  if (combined.includes("ciclo activo") || combined.includes("no disponible")) {
    return new ExpedienteArchivosSupabaseError(
      "El expediente no está disponible para esta operación.",
    );
  }
  if (combined.includes("aún no fue enviado")) {
    return new ExpedienteArchivosSupabaseError(
      "El expediente aún no fue enviado a Mesa.",
    );
  }
  if (
    combined.includes("log_action") ||
    combined.includes("function public.log_action") ||
    combined.includes("does not exist")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "No se pudo registrar la eliminación. Intenta de nuevo.",
    );
  }
  return new ExpedienteArchivosSupabaseError(
    "No se pudo eliminar el documento. Intenta de nuevo.",
  );
}
