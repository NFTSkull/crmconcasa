import type { ExpedienteMock } from "./mock.repo";
import { ExpedientesSupabaseError } from "./supabase.error";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  estatusCuentaParaIntegracion,
  type ExpedienteArchivoResumen,
} from "@/domain/expediente-archivos";
import { DOCUMENTO_CATALOGO_MAP } from "@/domain/expediente-archivos/types";

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

/** Pendientes exactos antes de «Enviar como reingreso» (no incrementa contador). */
export function buildReingresoManualEnvioPendientes(input: {
  hasMontoAprobado: boolean;
  datosGeneralesCompletos: boolean;
  camposFaltantesDatos: readonly string[];
  archivosResumen: readonly ExpedienteArchivoResumen[] | null;
  /** Default: 4 clásicos. Pasar lista del dueño para externos (7). */
  tiposEnvio?: readonly string[];
}): string[] {
  const out: string[] = [];
  if (!input.hasMontoAprobado) out.push("Monto aprobado");
  if (!input.datosGeneralesCompletos) {
    if (input.camposFaltantesDatos.length > 0) {
      out.push(...input.camposFaltantesDatos);
    } else {
      out.push("Datos Generales (guarda el formulario completo)");
    }
  }
  const byTipo = new Map(
    (input.archivosResumen ?? []).map((r) => [r.tipo_documento, r] as const),
  );
  const tipos = input.tiposEnvio ?? INTEGRATION_DOC_TIPOS_ASESOR_ENVIO;
  for (const tipo of tipos) {
    const row = byTipo.get(tipo as ExpedienteArchivoResumen["tipo_documento"]);
    const ok = row ? estatusCuentaParaIntegracion(row.estatus_revision) : false;
    if (!ok) {
      const label =
        DOCUMENTO_CATALOGO_MAP[tipo as keyof typeof DOCUMENTO_CATALOGO_MAP]?.label ??
        tipo.replace(/^cliente_/, "").replace(/_/g, " ");
      out.push(label);
    }
  }
  return out;
}

export function formatReingresoEnvioPendientesMessage(pendientes: readonly string[]): string {
  if (pendientes.length === 0) return "";
  const items = pendientes
    .slice(0, 12)
    .map((p) => `• ${p}`)
    .join("\n");
  const extra =
    pendientes.length > 12 ? `\n• …y ${pendientes.length - 12} más` : "";
  return `No puedes enviar todavía. Completa lo siguiente:\n${items}${extra}`;
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
  if (/FALTA_MONTO|monto aprobado/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Falta el monto aprobado del editor antes de enviar como reingreso.",
    );
  }
  if (/FALTAN_DATOS|faltan Datos Generales|datos del cliente/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Faltan Datos Generales. Complétalos y guárdalos antes de enviar como reingreso.",
    );
  }
  if (/FALTAN_DOCS|documentos obligatorios/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Faltan documentos obligatorios (INE frente/reverso, domicilio y estado de cuenta).",
    );
  }
  if (/INFONAVIT_DATOS_INCOMPLETOS/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Faltan datos Infonavit del cliente. Complétalos y guárdalos antes de enviar como reingreso.",
    );
  }
  if (/INFONAVIT_DATOS_VERSION_INVALIDA/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "Los datos Infonavit guardados no tienen la versión correcta. Vuelve a completar y guardar Datos Generales.",
    );
  }
  if (/INFONAVIT_NSS_MISMATCH/i.test(msg)) {
    return new ExpedientesSupabaseError(
      "El NSS de Datos Generales no coincide con el del expediente. Corrígelo y guarda antes de reingresar.",
    );
  }
  if (
    /INFONAVIT_SNAPSHOT_IMMUTABLE/i.test(msg) ||
    /expediente_infonavit_snapshots_exp_ver_uidx/i.test(msg) ||
    /infonavit_pdf_outbox_idem_uidx/i.test(msg)
  ) {
    return new ExpedientesSupabaseError(
      "No se pudo registrar el reingreso Infonavit. Intenta de nuevo más tarde.",
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
