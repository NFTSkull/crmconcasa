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

/**
 * Visibilidad UI de la card «Reingreso a Mesa» (hotfix 143).
 * No depende de etapa, checklist, monto ni submittedToMesa.
 */
export function puedeMostrarReingresoManualCard(input: {
  expedienteCancelado: boolean;
  role?: string | null;
}): boolean {
  if (input.expedienteCancelado) return false;
  if (input.role != null && input.role !== "asesor") return false;
  return true;
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
  if (/cancelado/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "El expediente está cancelado y no se puede reingresar.",
    );
  }
  if (/no encontrado|no disponible|P0002/i.test(msg) || code === "P0002") {
    return new ExpedientesSupabaseError(
      "Este expediente ya no está disponible para reingreso.",
    );
  }
  return new ExpedientesSupabaseError(
    msg || "No se pudo reingresar el expediente a Mesa.",
  );
}
