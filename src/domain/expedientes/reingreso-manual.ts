import type { ExpedienteMock } from "./mock.repo";
import { ExpedientesSupabaseError } from "./supabase.error";

/** Reingreso manual (mismo expediente → Mesa). Separado de P072. */
export type ReingresoManualInfo = Readonly<{
  count: number;
  at: string | null;
  by: string | null;
}>;

export function hasReingresoVisible(exp: Pick<ExpedienteMock, "reingreso" | "reingresoManual">): boolean {
  const manual = (exp.reingresoManual?.count ?? 0) > 0;
  const p072 = Boolean(exp.reingreso?.expedienteAnteriorId && exp.reingreso?.rechazoId);
  return manual || p072;
}

export function formatReingresoBadgeLabel(count: number): string {
  if (count > 1) return `REINGRESO · ${count}`;
  return "REINGRESO";
}

export function mapAsesorEnviarReingresoRpcError(error: {
  message?: string;
  code?: string;
}): ExpedientesSupabaseError {
  const msg = String(error.message ?? "");
  const code = String(error.code ?? "");

  if (/usuario no autenticado|perfil no encontrado/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Tu sesión no es válida. Vuelve a iniciar sesión.",
    );
  }
  if (/solo el asesor dueño|organización|rol no autorizado/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para reingresar este expediente a Mesa.",
    );
  }
  if (/nunca fue enviado/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Solo se puede reingresar un expediente que ya fue enviado a Mesa.",
    );
  }
  if (/ciclo activo/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "El expediente no está activo y no se puede reingresar.",
    );
  }
  if (/monto aprobado/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Se requiere un monto aprobado mayor a 0 para reingresar a Mesa.",
    );
  }
  if (/datos del cliente|porcentaje de cobro|método de pago/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Completa los datos obligatorios del cliente antes de reingresar a Mesa.",
    );
  }
  if (/documentos obligatorios/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Faltan documentos obligatorios de integración para reingresar a Mesa.",
    );
  }
  if (/NSS_YA_BLOQUEADO|23505/i.test(msg) || code === "23505") {
    return new ExpedientesSupabaseError(
      "Este NSS ya tiene un expediente enviado a Mesa.",
    );
  }
  if (/no encontrado|no disponible|P0002/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Este expediente ya no está disponible para reingreso.",
    );
  }
  return new ExpedientesSupabaseError(
    msg || "No se pudo reingresar el expediente a Mesa.",
  );
}
