import { ExpedientesSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `upsert_editor_decision` a mensajes claros en español. */
export function mapUpsertEditorDecisionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedientesSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (raw.includes("REENTRY_AMOUNT_PENDING")) {
    return new ExpedientesSupabaseError(
      "El monto aprobado del reingreso debe ser mayor a cero.",
    );
  }

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para guardar la decisión. Inicia sesión como editor activo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedientesSupabaseError(
      "Solo un editor puede registrar decisiones de monto.",
    );
  }

  if (
    msg.includes("fuera de la organización del editor")
  ) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para decidir sobre este expediente.",
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

  if (msg.includes("no se puede editar decisión tras enviar a mesa")) {
    return new ExpedientesSupabaseError(
      "No se puede editar la decisión después de enviar el expediente a Mesa.",
    );
  }

  if (msg.includes("monto_aprobado es obligatorio cuando decision = aprobado")) {
    return new ExpedientesSupabaseError(
      "El monto aprobado es obligatorio cuando la decisión es aprobada.",
    );
  }

  if (msg.includes("monto_aprobado debe ser mayor a 0")) {
    return new ExpedientesSupabaseError(
      "El monto aprobado debe ser mayor a cero.",
    );
  }

  if (msg.includes("no está en ciclo activo")) {
    return new ExpedientesSupabaseError(
      "Este expediente no está en ciclo activo.",
    );
  }

  return new ExpedientesSupabaseError(
    "No se pudo guardar la decisión del editor. Intenta de nuevo más tarde.",
  );
}
