import { ExpedientesSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `enviar_a_mesa` a mensajes claros en español. */
export function mapEnviarAMesaRpcError(error: {
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
      "No tienes permiso para enviar a Mesa. Inicia sesión como asesor activo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedientesSupabaseError(
      "Solo un asesor puede enviar expedientes a Mesa de control.",
    );
  }

  if (
    msg.includes("solo el asesor dueño") ||
    msg.includes("fuera de la organización del asesor")
  ) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para enviar este expediente a Mesa.",
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

  if (msg.includes("ya fue enviado a mesa")) {
    return new ExpedientesSupabaseError("Este expediente ya fue enviado a Mesa.");
  }

  if (msg.includes("nss_ya_bloqueado") || msg.includes("nss ya tiene un expediente enviado a mesa")) {
    return new ExpedientesSupabaseError(
      "Este NSS ya tiene un expediente enviado a Mesa.",
    );
  }

  if (msg.includes("falta decisión del editor")) {
    return new ExpedientesSupabaseError(
      "Falta registrar un monto aprobado mayor a cero antes del envío.",
    );
  }

  if (msg.includes("decisión del editor debe ser aprobado")) {
    return new ExpedientesSupabaseError(
      "Debe registrar un monto aprobado mayor a cero antes de enviar a Mesa.",
    );
  }

  if (msg.includes("monto aprobado del editor debe ser mayor a 0")) {
    return new ExpedientesSupabaseError(
      "El editor debe registrar un monto aprobado mayor a cero antes del envío.",
    );
  }

  if (msg.includes("faltan datos del cliente")) {
    return new ExpedientesSupabaseError(
      "Faltan los datos del cliente. Complétalos antes de enviar a Mesa.",
    );
  }

  if (msg.includes("rfc del cliente es obligatorio")) {
    return new ExpedientesSupabaseError(
      "El RFC del cliente es obligatorio antes de enviar a Mesa.",
    );
  }

  if (msg.includes("datos del cliente deben estar completos o validados")) {
    return new ExpedientesSupabaseError(
      "Los datos del cliente deben estar completos o validados antes del envío.",
    );
  }

  if (msg.includes("faltan datos obligatorios del cliente: porcentaje de cobro")) {
    return new ExpedientesSupabaseError(
      "Faltan datos obligatorios del cliente: porcentaje de cobro, monto calculado, método de pago.",
    );
  }

  if (msg.includes("faltan documentos obligatorios de integración")) {
    return new ExpedientesSupabaseError(
      "Faltan documentos obligatorios de integración. Sube todos los documentos requeridos antes de enviar a Mesa.",
    );
  }

  if (msg.includes("no está en ciclo activo")) {
    return new ExpedientesSupabaseError(
      "Este expediente no está en ciclo activo y no puede enviarse a Mesa.",
    );
  }

  return new ExpedientesSupabaseError(
    "No se pudo enviar a Mesa. Intenta de nuevo más tarde.",
  );
}
