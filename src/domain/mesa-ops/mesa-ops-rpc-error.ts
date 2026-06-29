import { MesaOpsSupabaseError } from "./supabase.error";

export function mapMesaTakeRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): MesaOpsSupabaseError {
  const msg = `${error.message ?? ""} ${error.details ?? ""}`.trim();

  if (msg.includes("asignado a otro operador")) {
    return new MesaOpsSupabaseError(
      "Este expediente ya fue tomado por otro usuario. Actualiza la bandeja.",
    );
  }

  if (error.code === "42501" || msg.includes("no autorizado") || msg.includes("no autenticado")) {
    return new MesaOpsSupabaseError("No tienes permiso para tomar este expediente.");
  }

  if (msg.includes("no ha sido enviado a Mesa")) {
    return new MesaOpsSupabaseError("El expediente no ha sido enviado a Mesa.");
  }

  if (msg.includes("no está en ciclo activo")) {
    return new MesaOpsSupabaseError("El expediente no está en ciclo activo.");
  }

  return new MesaOpsSupabaseError(
    msg || "No se pudo tomar el expediente. Intenta de nuevo más tarde.",
  );
}

export function mapMesaReleaseRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): MesaOpsSupabaseError {
  const msg = `${error.message ?? ""} ${error.details ?? ""}`.trim();

  if (msg.includes("motivo es obligatorio")) {
    return new MesaOpsSupabaseError(
      "El motivo es obligatorio al liberar un expediente de otro operador.",
    );
  }

  if (msg.includes("no tiene responsable asignado")) {
    return new MesaOpsSupabaseError("Este expediente no tiene responsable asignado.");
  }

  if (error.code === "42501" || msg.includes("solo el responsable o un administrador")) {
    return new MesaOpsSupabaseError("No tienes permiso para liberar este expediente.");
  }

  return new MesaOpsSupabaseError(
    msg || "No se pudo liberar el expediente. Intenta de nuevo más tarde.",
  );
}
