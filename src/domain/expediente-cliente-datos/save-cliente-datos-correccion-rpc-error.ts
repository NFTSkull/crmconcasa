import { ClienteDatosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `save_cliente_datos_correccion`. */
export function mapSaveClienteDatosCorreccionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ClienteDatosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new ClienteDatosSupabaseError(
      "No tienes permiso para corregir datos. Inicia sesión de nuevo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ClienteDatosSupabaseError("Solo el asesor dueño puede corregir los datos generales.");
  }

  if (msg.includes("solo el asesor dueño")) {
    return new ClienteDatosSupabaseError(
      "No tienes permiso para corregir datos en este expediente.",
    );
  }

  if (msg.includes("no fue enviado a mesa")) {
    return new ClienteDatosSupabaseError(
      "La corrección de datos solo aplica después de enviar el expediente a Mesa.",
    );
  }

  if (msg.includes("estado rechazado") || msg.includes("datos rechazados")) {
    return new ClienteDatosSupabaseError(
      "Solo puedes corregir datos generales que Mesa haya rechazado.",
    );
  }

  if (msg.includes("rfc inválido") || msg.includes("rfc obligatorio")) {
    return new ClienteDatosSupabaseError("Revisa el RFC del cliente.");
  }

  if (msg.includes("teléfono")) {
    return new ClienteDatosSupabaseError("Revisa el teléfono del cliente y referencias.");
  }

  if (msg.includes("could not find the function") || msg.includes("schema cache")) {
    return new ClienteDatosSupabaseError(
      "La corrección de datos aún no está disponible en el servidor. Contacta soporte.",
    );
  }

  return new ClienteDatosSupabaseError(
    "No se pudo guardar la corrección de datos. Intenta de nuevo más tarde.",
  );
}
