export class MontoMejoravitSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MontoMejoravitSupabaseError";
  }
}

const CONCURRENCY_MSG =
  "El expediente cambió mientras realizabas la actualización. Revisa los datos vigentes e intenta nuevamente.";

/** Mapea errores de RPCs P090 a mensajes seguros en español. */
export function mapMontoMejoravitRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): MontoMejoravitSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado") ||
    msg.includes("rol no autorizado") ||
    msg.includes("no autorizado") ||
    msg.includes("fuera de la organización")
  ) {
    return new MontoMejoravitSupabaseError(
      "No tienes permiso para operar el monto Mejoravit de este expediente.",
    );
  }

  if (error.code === "P0002" || msg.includes("expediente no encontrado")) {
    return new MontoMejoravitSupabaseError(
      "Expediente no encontrado o no tienes permiso para verlo.",
    );
  }

  if (msg.includes("no está en ciclo activo") || msg.includes("ciclo activo")) {
    return new MontoMejoravitSupabaseError(
      "No se puede actualizar el monto: el expediente no está activo.",
    );
  }

  if (msg.includes("aún no fue enviado a mesa") || msg.includes("enviado a mesa")) {
    return new MontoMejoravitSupabaseError(
      "No se puede actualizar el monto: el expediente aún no fue enviado a Mesa.",
    );
  }

  if (msg.includes("diferente al monto vigente")) {
    return new MontoMejoravitSupabaseError(
      "El monto nuevo debe ser diferente al monto vigente.",
    );
  }

  if (msg.includes("falta el porcentaje") || msg.includes("porcentaje de cobro")) {
    return new MontoMejoravitSupabaseError(
      "No existe un porcentaje de cobro registrado. Debe capturarse antes de actualizar el monto.",
    );
  }

  if (msg.includes("motivo") && (msg.includes("obligatorio") || msg.includes("500"))) {
    return new MontoMejoravitSupabaseError(
      "El motivo es obligatorio y no puede exceder 500 caracteres.",
    );
  }

  if (
    msg.includes("mayor que cero") ||
    msg.includes("monto nuevo") ||
    msg.includes("monto operativo") ||
    msg.includes("inválido")
  ) {
    return new MontoMejoravitSupabaseError(
      "El monto indicado no es válido. Revisa el valor e intenta nuevamente.",
    );
  }

  if (
    msg.includes("could not serialize") ||
    msg.includes("deadlock") ||
    msg.includes("concurrent") ||
    msg.includes("for update")
  ) {
    return new MontoMejoravitSupabaseError(CONCURRENCY_MSG);
  }

  return new MontoMejoravitSupabaseError(
    "No se pudo completar la operación de monto Mejoravit. Intenta nuevamente.",
  );
}

export const MONTO_MEJORAVIT_CONCURRENCY_MESSAGE = CONCURRENCY_MSG;
