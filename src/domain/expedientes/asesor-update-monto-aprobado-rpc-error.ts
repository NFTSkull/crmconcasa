import { ExpedientesSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `asesor_update_monto_aprobado` a mensajes claros en español. */
export function mapAsesorUpdateMontoAprobadoRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedientesSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para guardar el monto. Inicia sesión como asesor activo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedientesSupabaseError("Solo un asesor puede registrar el monto aprobado.");
  }

  if (msg.includes("solo el asesor dueño") || msg.includes("otra organización")) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para actualizar el monto de este expediente.",
    );
  }

  if (error.code === "P0002" || msg.includes("expediente no encontrado")) {
    return new ExpedientesSupabaseError(
      "Expediente no encontrado o no tienes permiso para verlo.",
    );
  }

  if (msg.includes("expediente no disponible")) {
    return new ExpedientesSupabaseError("Este expediente ya no está disponible.");
  }

  if (msg.includes("ya enviado a mesa")) {
    return new ExpedientesSupabaseError(
      "No puedes modificar el monto: el expediente ya fue enviado a Mesa.",
    );
  }

  if (msg.includes("monto_aprobado debe ser mayor a 0")) {
    return new ExpedientesSupabaseError("El monto aprobado debe ser mayor a cero.");
  }

  if (msg.includes("no activo")) {
    return new ExpedientesSupabaseError("Este expediente no está activo.");
  }

  return new ExpedientesSupabaseError(
    "No se pudo guardar el monto aprobado. Intenta de nuevo más tarde.",
  );
}
