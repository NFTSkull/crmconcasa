import { ExpedientesSupabaseError } from "./supabase.error";

export function mapEditorDraftRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedientesSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("no autenticado") ||
    msg.includes("rol no autorizado") ||
    msg.includes("fuera de organización")
  ) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para guardar el borrador de re-precalificación.",
    );
  }

  if (msg.includes("pending stale") || msg.includes("mismatch")) {
    return new ExpedientesSupabaseError(
      "La re-precalificación ya no está pendiente. Recarga el listado.",
    );
  }

  if (msg.includes("no hay re-precal pendiente")) {
    return new ExpedientesSupabaseError(
      "No hay una re-precalificación pendiente para guardar borrador.",
    );
  }

  if (msg.includes("expediente no disponible") || msg.includes("no encontrado")) {
    return new ExpedientesSupabaseError(
      "El expediente no está disponible para guardar borrador.",
    );
  }

  return new ExpedientesSupabaseError(
    raw || "No se pudo guardar el borrador de re-precalificación.",
  );
}