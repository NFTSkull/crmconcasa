import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `upsert_agenda_config_biometricos` a mensajes claros. */
export function mapUpsertAgendaConfigBiometricosRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaBiometricosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("rol no autorizado")) {
    return new AgendaBiometricosSupabaseError(
      "Solo Mesa Admin o Super Admin pueden guardar la configuración biométrica.",
    );
  }

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new AgendaBiometricosSupabaseError(
      "No tienes permiso para configurar la agenda. Inicia sesión de nuevo.",
    );
  }

  if (msg.includes("no puede configurar otra organización")) {
    return new AgendaBiometricosSupabaseError(
      "No puedes configurar la agenda de otra organización.",
    );
  }

  if (msg.includes("timezone inválido") || msg.includes("timezone es obligatorio")) {
    return new AgendaBiometricosSupabaseError("La zona horaria no es válida.");
  }

  if (msg.includes("allowed_weekdays")) {
    return new AgendaBiometricosSupabaseError(
      "Revisa los días permitidos (lunes=1 … domingo=7, sin duplicados).",
    );
  }

  if (msg.includes("slots")) {
    return new AgendaBiometricosSupabaseError(
      "Revisa los horarios (formato HH:mm, sin duplicados).",
    );
  }

  if (msg.includes("locations")) {
    return new AgendaBiometricosSupabaseError(
      "Revisa las sedes: al menos una activa si la agenda está habilitada.",
    );
  }

  if (msg.includes("capacity_per_slot")) {
    return new AgendaBiometricosSupabaseError(
      "El cupo por horario debe ser al menos 1 en cada sede.",
    );
  }

  if (msg.includes("location_id inválido")) {
    return new AgendaBiometricosSupabaseError(
      "El identificador de sede solo puede usar letras minúsculas, números, guiones y guion bajo.",
    );
  }

  if (msg.includes("config debe ser un objeto")) {
    return new AgendaBiometricosSupabaseError("La configuración enviada no es válida.");
  }

  if (error.code === "P0002" || msg.includes("organización no encontrada")) {
    return new AgendaBiometricosSupabaseError("Organización no encontrada o inactiva.");
  }

  if (raw) {
    const cleaned = raw.replace(/^upsert_agenda_config_biometricos:\s*/i, "");
    return new AgendaBiometricosSupabaseError(cleaned);
  }

  return new AgendaBiometricosSupabaseError(
    "No se pudo guardar la configuración biométrica. Intenta de nuevo más tarde.",
  );
}
