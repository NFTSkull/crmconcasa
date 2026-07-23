import { AgendaFirmasSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `upsert_agenda_config_firmas` a mensajes claros. */
export function mapUpsertAgendaConfigFirmasRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaFirmasSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("rol no autorizado")) {
    return new AgendaFirmasSupabaseError(
      "Solo Mesa Admin o Super Admin pueden guardar la configuración de firmas.",
    );
  }

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new AgendaFirmasSupabaseError(
      "No tienes permiso para configurar la agenda. Inicia sesión de nuevo.",
    );
  }

  if (msg.includes("no puede configurar otra organización")) {
    return new AgendaFirmasSupabaseError(
      "No puedes configurar la agenda de otra organización.",
    );
  }

  if (msg.includes("timezone inválido") || msg.includes("timezone es obligatorio")) {
    return new AgendaFirmasSupabaseError("La zona horaria no es válida.");
  }

  if (msg.includes("allowed_weekdays")) {
    return new AgendaFirmasSupabaseError(
      "Revisa los días permitidos (lunes=1 … domingo=7, sin duplicados).",
    );
  }

  if (msg.includes("slots")) {
    return new AgendaFirmasSupabaseError(
      "Revisa los horarios (formato HH:mm, sin duplicados).",
    );
  }

  if (msg.includes("locations")) {
    return new AgendaFirmasSupabaseError(
      "Revisa las sedes: al menos una activa si la agenda está habilitada.",
    );
  }

  {
    const occupiedMatch = raw.match(
      /No puedes establecer un cupo menor a las (\d+) citas ya reservadas/i,
    );
    if (occupiedMatch) {
      const occupied = occupiedMatch[1];
      return new AgendaFirmasSupabaseError(
        `No puedes establecer un cupo menor a las ${occupied} citas ya reservadas. Capacidad mínima permitida: ${occupied}.`,
      );
    }
  }

  if (msg.includes("capacity_per_slot")) {
    return new AgendaFirmasSupabaseError(
      "El cupo por horario debe ser al menos 1 en cada sede.",
    );
  }

  if (msg.includes("location_id inválido")) {
    return new AgendaFirmasSupabaseError(
      "El identificador de sede solo puede usar letras minúsculas, números, guiones y guion bajo.",
    );
  }

  if (msg.includes("config debe ser un objeto")) {
    return new AgendaFirmasSupabaseError("La configuración enviada no es válida.");
  }

  if (error.code === "P0002" || msg.includes("organización no encontrada")) {
    return new AgendaFirmasSupabaseError("Organización no encontrada o inactiva.");
  }

  if (raw) {
    const cleaned = raw.replace(/^upsert_agenda_config_firmas:\s*/i, "");
    return new AgendaFirmasSupabaseError(cleaned);
  }

  return new AgendaFirmasSupabaseError(
    "No se pudo guardar la configuración de firmas. Intenta de nuevo más tarde.",
  );
}
