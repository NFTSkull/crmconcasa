import { ClienteDatosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `save_cliente_datos` a mensajes claros en español. */
export function mapSaveClienteDatosRpcError(error: {
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
      "No tienes permiso para guardar datos del cliente. Inicia sesión como asesor activo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ClienteDatosSupabaseError(
      "Solo un asesor puede guardar los datos del cliente.",
    );
  }

  if (
    msg.includes("solo el asesor dueño") ||
    msg.includes("expediente de otra organización")
  ) {
    return new ClienteDatosSupabaseError(
      "No tienes permiso para guardar datos de este expediente.",
    );
  }

  if (error.code === "P0002" || msg.includes("expediente no encontrado")) {
    return new ClienteDatosSupabaseError(
      "Expediente no encontrado o no tienes permiso para verlo.",
    );
  }

  if (msg.includes("expediente ya enviado a mesa")) {
    return new ClienteDatosSupabaseError(
      "No se pueden editar los datos del cliente después de enviar a Mesa.",
    );
  }

  if (msg.includes("rfc obligatorio")) {
    return new ClienteDatosSupabaseError("El RFC es obligatorio.");
  }

  if (msg.includes("rfc inválido")) {
    return new ClienteDatosSupabaseError("El RFC no tiene un formato válido.");
  }

  if (msg.includes("no hay monto aprobado para calcular el cobro")) {
    return new ClienteDatosSupabaseError(
      "No hay monto aprobado para calcular el cobro.",
    );
  }

  if (msg.includes("porcentaje de cobro es obligatorio")) {
    return new ClienteDatosSupabaseError("El porcentaje de cobro es obligatorio.");
  }

  if (msg.includes("porcentaje de cobro inválido")) {
    return new ClienteDatosSupabaseError(
      "El porcentaje de cobro debe ser mayor a 0 y menor o igual a 100.",
    );
  }

  if (msg.includes("método de pago es obligatorio")) {
    return new ClienteDatosSupabaseError("El método de pago es obligatorio.");
  }

  if (msg.includes("la dirección es obligatoria")) {
    return new ClienteDatosSupabaseError("La dirección es obligatoria.");
  }

  if (msg.includes("teléfono obligatorio")) {
    return new ClienteDatosSupabaseError("El celular del cliente es obligatorio.");
  }

  if (msg.includes("teléfono inválido")) {
    return new ClienteDatosSupabaseError(
      "El celular debe tener exactamente 10 dígitos (México).",
    );
  }

  if (msg.includes("teléfono repetido")) {
    return new ClienteDatosSupabaseError(
      "Ese teléfono ya está registrado en otro expediente de la organización.",
    );
  }

  if (msg.includes("nombre de referencia obligatorio")) {
    return new ClienteDatosSupabaseError("Cada referencia debe tener nombre.");
  }

  if (msg.includes("teléfono de referencia inválido")) {
    return new ClienteDatosSupabaseError(
      "Cada referencia debe tener un celular válido de 10 dígitos.",
    );
  }

  if (msg.includes("teléfono repetido en referencias")) {
    return new ClienteDatosSupabaseError(
      "El celular del cliente no puede repetirse en las referencias.",
    );
  }

  if (msg.includes("teléfono de referencia repetido")) {
    return new ClienteDatosSupabaseError(
      "Hay teléfonos repetidos entre las referencias.",
    );
  }

  if (msg.includes("nombre de referencia repetido")) {
    return new ClienteDatosSupabaseError("Hay nombres repetidos en las referencias.");
  }

  if (msg.includes("asesor no puede marcar validado")) {
    return new ClienteDatosSupabaseError(
      "Solo Mesa de control puede validar los datos del cliente.",
    );
  }

  return new ClienteDatosSupabaseError(
    "No se pudieron guardar los datos del cliente. Intenta de nuevo más tarde.",
  );
}
