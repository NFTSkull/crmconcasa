import {
  deriveRetencionAcuseAvisoFaltantes,
  inferRetencionOpcionFromArchivos,
  listRetencionUploadsForOpcion,
  retencionOpcionAmbiguaFromArchivos,
  RETENCION_ETAPA_OPERATIVA_ID,
  type RetencionFaltanteItem,
} from "@/domain/expediente-archivos/retencion-acuse-aviso";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import {
  puedeEnviarRetencionAcuseAvisoAMesa,
  retencionEnvioEstadoEfectivo,
  retencionOpcionAsesorEditable,
  retencionOpcionParaPanelAsesor,
  retencionPuedeReenviarAMesa,
  type RetencionEnvioMesaUiEstado,
} from "./retencion-envio-mesa";
import type {
  ExpedienteRetencionEnvioMesa,
  ExpedienteRetencionOpcion,
  RetencionOpcion,
} from "./types";

/** Borrador local de opción A/B por expediente hasta `enviar_retencion_mesa`. */
export const RETENCION_OPCION_SESSION_STORAGE_PREFIX = "retencion-opcion:";

export function retencionOpcionDraftStorageKey(expedienteId: string): string {
  return `${RETENCION_OPCION_SESSION_STORAGE_PREFIX}${String(expedienteId).trim()}`;
}

export function readRetencionOpcionDraft(
  expedienteId: string,
): RetencionOpcion | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(
      retencionOpcionDraftStorageKey(expedienteId),
    );
    if (raw === "con_sello" || raw === "sin_sello") return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeRetencionOpcionDraft(
  expedienteId: string,
  opcion: RetencionOpcion | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = retencionOpcionDraftStorageKey(expedienteId);
    if (!opcion) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, opcion);
  } catch {
    // sessionStorage puede fallar en modo privado; el draft en memoria sigue.
  }
}

/** Panel retención asesor Supabase: etapa 8 y expediente ya enviado a Mesa. */
export function canShowAsesorRetencionSupabasePanel(params: {
  dataModeSupabase: boolean;
  etapaActual: number | null | undefined;
  submittedToMesa: boolean;
}): boolean {
  return (
    params.dataModeSupabase &&
    params.etapaActual === RETENCION_ETAPA_OPERATIVA_ID &&
    params.submittedToMesa === true
  );
}

export function retencionDocEstatusLabelAsesor(
  e: ExpedienteArchivoResumen["estatus_revision"] | undefined,
): string {
  if (!e || e === "faltante") return "Faltante";
  if (e === "subido") return "Subido — Mesa revisará después del envío";
  if (e === "resubido") return "Resubido — Mesa revisará de nuevo";
  if (e === "validado") return "Aceptado por Mesa";
  return "Rechazado por Mesa";
}

export function asesorRetencionBloqueEstadoLabel(
  uiEstado: RetencionEnvioMesaUiEstado,
): string {
  if (uiEstado === "no_enviado") return "Pendiente de envío a Mesa";
  if (uiEstado === "correccion_requerida") return "Corrección requerida";
  return "Enviado a Mesa — pendiente de revisión";
}

type ArchivoRowMin = Pick<
  ExpedienteArchivoResumen,
  "tipo_documento" | "id" | "estatus_revision"
>;

export type AsesorRetencionPanelView = Readonly<{
  opcionPanel: RetencionOpcion | null;
  opcionAmbigua: boolean;
  opcionEditable: boolean;
  uiEstado: RetencionEnvioMesaUiEstado;
  bloqueEstadoLabel: string;
  faltantes: readonly RetencionFaltanteItem[];
  puedeEnviarAMesa: boolean;
  uploads: ReturnType<typeof listRetencionUploadsForOpcion>;
}>;

export function deriveAsesorRetencionPanelView(params: {
  /** Selección en memoria de la sesión actual (radio). */
  opcionDraft: RetencionOpcion | null;
  /** Ayuda UX en `sessionStorage` del expediente; no prueba existencia de documentos. */
  opcionSessionDraft?: RetencionOpcion | null;
  opcionPersistida: ExpedienteRetencionOpcion | null;
  envio: ExpedienteRetencionEnvioMesa | null;
  archivos: readonly ArchivoRowMin[];
}): AsesorRetencionPanelView {
  const opcionDb = params.opcionPersistida?.retencion_opcion ?? null;
  const opcionInferida = inferRetencionOpcionFromArchivos(params.archivos);
  const opcionSession = params.opcionSessionDraft ?? null;
  // Orden: DB → inferencia desde docs activos → sessionStorage → borrador en memoria.
  const opcionEfectiva =
    opcionDb ?? opcionInferida ?? opcionSession ?? params.opcionDraft ?? null;
  const uiEstado = retencionEnvioEstadoEfectivo(
    params.envio,
    params.archivos,
    opcionEfectiva,
  );
  const opcionPanel =
    retencionOpcionParaPanelAsesor(params.envio, opcionEfectiva, uiEstado) ??
    opcionInferida ??
    opcionSession ??
    params.opcionDraft ??
    null;
  const opcionEditable = retencionOpcionAsesorEditable(uiEstado);
  const faltantes = deriveRetencionAcuseAvisoFaltantes({
    retencion_opcion: opcionPanel,
    archivos: params.archivos,
  });
  const puedeEnviarAMesa =
    opcionPanel !== null &&
    retencionPuedeReenviarAMesa(uiEstado, faltantes) &&
    puedeEnviarRetencionAcuseAvisoAMesa(faltantes);

  return {
    opcionPanel,
    opcionAmbigua: retencionOpcionAmbiguaFromArchivos(params.archivos),
    opcionEditable,
    uiEstado,
    bloqueEstadoLabel: asesorRetencionBloqueEstadoLabel(uiEstado),
    faltantes,
    puedeEnviarAMesa,
    uploads: listRetencionUploadsForOpcion(opcionPanel),
  };
}
