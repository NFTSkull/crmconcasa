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

  if (msg.includes("telefono_casa_requerido")) {
    return new ClienteDatosSupabaseError("El teléfono de casa es obligatorio.");
  }

  if (msg.includes("telefono_casa_invalido")) {
    return new ClienteDatosSupabaseError(
      "El teléfono de casa debe tener exactamente 10 dígitos.",
    );
  }

  if (
    msg.includes("telefono_casa_duplicado") ||
    msg.includes("telefono_casa_duplicado_datos_generales") ||
    msg.includes("cliente_datos_telefono_casa_duplicado")
  ) {
    return new ClienteDatosSupabaseError(
      "El teléfono de casa no puede repetirse con celular, teléfono empresa ni referencias del mismo expediente.",
    );
  }

  if (msg.includes("cliente_datos_celular_igual_telefono_casa")) {
    return new ClienteDatosSupabaseError(
      "El celular debe ser distinto al teléfono de casa.",
    );
  }

  if (msg.includes("cliente_datos_telefono_duplicado")) {
    return new ClienteDatosSupabaseError(
      "No se pueden repetir números telefónicos dentro de los Datos Generales del cliente.",
    );
  }

  if (msg.includes("nss debe tener 11 dígitos")) {
    return new ClienteDatosSupabaseError("El NSS debe tener exactamente 11 dígitos.");
  }
  if (msg.includes("cp debe tener 5 dígitos")) {
    return new ClienteDatosSupabaseError("El código postal debe tener exactamente 5 dígitos.");
  }
  if (msg.includes("el plazo solo admite números")) {
    return new ClienteDatosSupabaseError("El plazo solo admite números.");
  }
  if (msg.includes("nombre del cliente solo admite")) {
    return new ClienteDatosSupabaseError(
      "El nombre del cliente solo admite letras, espacios, guiones y apóstrofes.",
    );
  }
  if (msg.includes("nombre del beneficiario solo admite")) {
    return new ClienteDatosSupabaseError(
      "El nombre del beneficiario solo admite letras, espacios, guiones y apóstrofes.",
    );
  }
  if (msg.includes("nombre de referencia solo admite")) {
    return new ClienteDatosSupabaseError(
      "El nombre de las referencias solo admite letras, espacios, guiones y apóstrofes.",
    );
  }
  if (msg.includes("el parentesco solo admite")) {
    return new ClienteDatosSupabaseError(
      "El parentesco solo admite letras, espacios, guiones y apóstrofes.",
    );
  }

  if (msg.includes("teléfono")) {
    return new ClienteDatosSupabaseError("Revisa los teléfonos del cliente, empresa y referencias.");
  }

  if (msg.includes("faltan datos del cliente") || msg.includes("create_reingreso")) {
    return new ClienteDatosSupabaseError(
      "No se pudo crear/guardar los Datos Generales. Completa los campos obligatorios e intenta de nuevo.",
    );
  }

  if (msg.includes("reingreso") && msg.includes("no válido")) {
    return new ClienteDatosSupabaseError(
      "El reingreso ya no está activo. Vuelve a enviarlo como reingreso cuando corresponda.",
    );
  }

  if (msg.includes("could not find the function") || msg.includes("schema cache")) {
    return new ClienteDatosSupabaseError(
      "La corrección de datos aún no está disponible en el servidor. Contacta soporte.",
    );
  }

  // Conservar mensaje SQL útil cuando sea legible.
  if (raw && !msg.includes("save_cliente_datos_correccion:")) {
    return new ClienteDatosSupabaseError(raw);
  }
  if (/save_cliente_datos(_correccion)?:/i.test(raw)) {
    const cleaned = raw.replace(/save_cliente_datos(_correccion)?:\s*/i, "").trim();
    if (cleaned) return new ClienteDatosSupabaseError(cleaned);
  }

  return new ClienteDatosSupabaseError(
    "No se pudo guardar la información. Intenta de nuevo más tarde.",
  );
}
