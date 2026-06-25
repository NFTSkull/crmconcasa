import { ExpedientesSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `avanzar_etapa_operativa` a mensajes claros en español. */
export function mapAvanzarEtapaRpcError(error: {
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
      "No tienes permiso para avanzar la etapa. Inicia sesión como usuario de Mesa activo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedientesSupabaseError(
      "Solo Mesa de control puede avanzar la etapa operativa del expediente.",
    );
  }

  if (
    msg.includes("no autorizado para operar este expediente") ||
    msg.includes("fuera de la organización del actor")
  ) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para avanzar la etapa de este expediente.",
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

  if (msg.includes("no ha sido enviado a mesa")) {
    return new ExpedientesSupabaseError(
      "El expediente aún no fue enviado a Mesa de control.",
    );
  }

  if (msg.includes("no está en ciclo activo")) {
    return new ExpedientesSupabaseError(
      "Este expediente no está en ciclo activo y no puede avanzar de etapa.",
    );
  }

  if (msg.includes("subestado debe ser en_validacion_mesa")) {
    return new ExpedientesSupabaseError(
      "El expediente no está en validación por Mesa. No se puede continuar desde esta etapa.",
    );
  }

  if (msg.includes("solo se permite avanzar desde etapa 1")) {
    return new ExpedientesSupabaseError(
      "Solo se puede continuar desde la etapa de Integración (etapa 1).",
    );
  }

  if (msg.includes("datos del cliente deben estar validados")) {
    return new ExpedientesSupabaseError(
      "Los datos generales deben estar validados por Mesa antes de continuar.",
    );
  }

  if (msg.includes("faltan datos del cliente")) {
    return new ExpedientesSupabaseError(
      "Faltan los datos del cliente. Complétalos y valídalos antes de continuar.",
    );
  }

  if (msg.includes("faltan documentos obligatorios validados")) {
    return new ExpedientesSupabaseError(
      "Faltan documentos obligatorios validados. Valida los 7 documentos requeridos antes de continuar.",
    );
  }

  if (msg.includes("transición no soportada") || msg.includes("no soportada para etapa")) {
    return new ExpedientesSupabaseError(
      "No hay una transición de etapa disponible para el estado actual del expediente.",
    );
  }

  return new ExpedientesSupabaseError(
    "No se pudo avanzar la etapa. Intenta de nuevo más tarde.",
  );
}
