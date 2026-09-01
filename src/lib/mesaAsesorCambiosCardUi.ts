/**
 * P194 — tarjeta de cambios del asesor en bandeja Mesa (copy + preview).
 */

import {
  formatMesaAsesorCambiosResumen,
  formatMesaAsesorReenviadoAt,
  hasAdvisorChangeDetails,
  hasMesaAsesorCambiosPanelContent,
  MESA_ASESOR_CAMBIOS_HISTORY_EXACT_BADGE,
  MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_BADGE,
  MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_BODY,
  MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_DETAIL,
  MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_BODY,
  MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_DETAIL,
  MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_TITLE,
  type MesaAsesorCambioHistoryConfidence,
  type MesaAsesorCambioPreviewItem,
  visibleAdvisorChangesCount,
} from "@/lib/mesaAsesorCambiosUi";
import {
  MESA_CAMBIO_ADVISOR_COPY,
  MESA_CAMBIO_AMBIGUOUS_COPY,
  MESA_CAMBIO_CTA_REVISAR_CAMBIOS,
  MESA_CAMBIO_CTA_VER_CAMBIOS,
  MESA_CAMBIO_ESTADO_POR_REVISAR,
  MESA_CAMBIO_LEGACY_COPY,
  mesaCambioCtaRevisarLabel,
  mesaCambioFechaLoteLabel,
  mesaCambioMuestraEstadoPorRevisar,
  mesaCambioOrigenBadge,
  mesaCambioRequestTypeLabel,
  type MesaCambioRevisionOrigen,
} from "@/lib/mesaCambiosRevisionOrigenUi";

export type MesaCambioRevisionEstadoEfectivo =
  | "CORRECTION_PENDING_REVIEW"
  | "ADVISOR_UPDATE_PENDING_REVIEW"
  | "WAITING_ADVISOR"
  | "CLOSED"
  | "SUPERSEDED";

export const MESA_CAMBIO_DETALLE_NO_DISPONIBLE =
  "Corrección recibida · detalle no disponible";
export const MESA_CAMBIO_ACTUALIZACION_DETALLE_NO_DISPONIBLE =
  "Actualización recibida · detalle no disponible";
export const MESA_CAMBIO_DETALLE_CARGANDO =
  "Cargando detalle de actualización…";
export const MESA_CAMBIO_DETALLE_TEMPORAL_NO_DISPONIBLE =
  "Detalle temporalmente no disponible";
export const MESA_CAMBIO_HISTORICA_FIRMADO =
  "Histórica · recibida antes de Firmado";

export type MesaAsesorCambiosCardInput = Readonly<{
  revisionEstado?: MesaCambioRevisionEstadoEfectivo | string | null;
  origin?: MesaCambioRevisionOrigen | null;
  etapaActual?: number | null;
  primaryCambioBatchId?: string | null;
  advisorChangesHydrated?: boolean;
  enrichFailed?: boolean;
  advisorChangeBatchId?: string | null;
  advisorChangesCount?: number | null;
  advisorChangesSubmittedAt?: string | null;
  advisorChangesSummary?: readonly string[] | null;
  advisorChangesPreview?: readonly MesaAsesorCambioPreviewItem[] | null;
  historyConfidence?: MesaAsesorCambioHistoryConfidence | null;
  historySource?: MesaAsesorCambioPreviewItem["source"] | null;
  historyNote?: string | null;
  cambioRequestAt?: string | null;
  cambioRequestType?: string | null;
  correctionRequestedAt?: string | null;
  correctionRequestedByName?: string | null;
  correctionRequestedNote?: string | null;
  correctionRequestedReason?: string | null;
  correctionResubmittedAt?: string | null;
  ultimaCorreccionEnviadaAt?: string | null;
  resumenDocumental?: string | null;
}>;

export type MesaAsesorCambiosCardModel = Readonly<{
  showBlock: boolean;
  historica: boolean;
  firmadoHistorico: boolean;
  loteVacio: boolean;
  changeDetails: boolean;
  header: string;
  estadoPorRevisar: boolean;
  historicaFirmadoBadge: string | null;
  advisorCopy: string | null;
  ambiguousCopy: string | null;
  legacyCopy: string | null;
  historyBadge: string | null;
  historyTitle: string | null;
  historyBody: string | null;
  historyDetail: string | null;
  resumenLines: readonly string[];
  solicitadaAt: string | null;
  loteAt: string | null;
  tipoHumano: string | null;
  solicitadaPor: string | null;
  nota: string | null;
  motivo: string | null;
  showRevisarCambios: boolean;
  showAbrirExpediente: boolean;
  ctaLabel: string;
  detalleLoading: boolean;
  detalleNoDisponible: boolean;
  detalleTemporalNoDisponible: boolean;
  batchMismatch: boolean;
}>;

function previewLabels(
  preview: readonly MesaAsesorCambioPreviewItem[] | null | undefined,
  summary: readonly string[] | null | undefined,
): readonly string[] {
  const fromPreview = (preview ?? [])
    .map((p) => String(p.label ?? "").trim())
    .filter(Boolean);
  if (fromPreview.length > 0) return fromPreview;
  return (summary ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
}

function isPendingReview(revisionEstado: string): boolean {
  return (
    revisionEstado === "CORRECTION_PENDING_REVIEW" ||
    revisionEstado === "ADVISOR_UPDATE_PENDING_REVIEW"
  );
}

export function buildMesaAsesorCambiosCardModel(
  input: MesaAsesorCambiosCardInput,
): MesaAsesorCambiosCardModel {
  const origin = input.origin ?? null;
  const etapaActual = input.etapaActual ?? null;
  const primaryCambioBatchId = String(input.primaryCambioBatchId ?? "").trim() || null;
  const enrichBatchId = String(input.advisorChangeBatchId ?? "").trim() || null;
  const hasPrimaryBatch = Boolean(primaryCambioBatchId);
  const advisorChangesHydrated =
    input.advisorChangesHydrated ?? !hasPrimaryBatch;

  const revisionEstado = String(input.revisionEstado ?? "").trim();
  const pendingReview = isPendingReview(revisionEstado);

  const batchMismatch =
    advisorChangesHydrated &&
    hasPrimaryBatch &&
    Boolean(enrichBatchId) &&
    primaryCambioBatchId !== enrichBatchId;

  const useEnrich = advisorChangesHydrated && !batchMismatch;
  const displayBatchId = useEnrich ? enrichBatchId : null;
  const displayCount = useEnrich ? input.advisorChangesCount : null;
  const displayPreview = useEnrich ? input.advisorChangesPreview : null;
  const displaySummary = useEnrich ? input.advisorChangesSummary : null;
  const displaySubmittedAt = useEnrich ? input.advisorChangesSubmittedAt : null;

  const detalleLoading = pendingReview && hasPrimaryBatch && !advisorChangesHydrated;

  const visibleCount = visibleAdvisorChangesCount({
    advisorChangesCount: displayCount,
    historyConfidence: input.historyConfidence,
  });
  const changeDetails = hasAdvisorChangeDetails({
    advisorChangeBatchId: displayBatchId,
    advisorChangesCount: displayCount,
    historyConfidence: input.historyConfidence,
  });
  const loteVacio =
    Boolean(displayBatchId) &&
    (displayCount ?? 0) <= 0 &&
    input.historyConfidence !== "EXACT";
  const historica =
    input.resumenDocumental === "correccion_enviada" && !displayBatchId && !hasPrimaryBatch;
  const labels = previewLabels(displayPreview, displaySummary);
  const resumenLines = formatMesaAsesorCambiosResumen(labels, visibleCount);
  const hasSummary = changeDetails || labels.length > 0 || loteVacio;

  const knownInactive =
    revisionEstado === "CLOSED" ||
    revisionEstado === "SUPERSEDED" ||
    revisionEstado === "WAITING_ADVISOR";
  const showBlock = pendingReview
    ? true
    : knownInactive
      ? false
      : input.resumenDocumental === "correccion_enviada" ||
        hasSummary ||
        loteVacio;

  const firmadoHistorico =
    (etapaActual ?? 0) >= 11 &&
    pendingReview &&
    (changeDetails || hasPrimaryBatch || Boolean(displayBatchId) || loteVacio);

  const detalleTemporalNoDisponible =
    pendingReview &&
    advisorChangesHydrated &&
    !detalleLoading &&
    (batchMismatch ||
      (hasPrimaryBatch && !changeDetails && labels.length === 0));

  const detalleNoDisponible =
    pendingReview &&
    advisorChangesHydrated &&
    !detalleLoading &&
    !batchMismatch &&
    !detalleTemporalNoDisponible &&
    !changeDetails &&
    labels.length === 0 &&
    !hasPrimaryBatch;

  const estadoPorRevisarOperativo =
    !firmadoHistorico &&
    (etapaActual ?? 0) < 11 &&
    mesaCambioMuestraEstadoPorRevisar(origin);

  const header = detalleLoading
    ? origin === "ADVISOR_UPDATE"
      ? "Actualización del asesor"
      : origin === "REQUESTED_CORRECTION"
        ? "Corrección recibida"
        : "Cambio por revisar"
    : batchMismatch || detalleTemporalNoDisponible
      ? origin === "ADVISOR_UPDATE"
        ? "Actualización del asesor · detalle temporalmente no disponible"
        : MESA_CAMBIO_DETALLE_NO_DISPONIBLE
      : detalleNoDisponible
        ? origin === "ADVISOR_UPDATE"
          ? MESA_CAMBIO_ACTUALIZACION_DETALLE_NO_DISPONIBLE
          : MESA_CAMBIO_DETALLE_NO_DISPONIBLE
        : origin === "REQUESTED_CORRECTION" && pendingReview && !firmadoHistorico
          ? `Corrección recibida · ${visibleCount} cambio${visibleCount === 1 ? "" : "s"}`
          : origin
            ? `${mesaCambioOrigenBadge(origin)} · ${visibleCount} cambio${visibleCount === 1 ? "" : "s"}`
            : `${visibleCount} cambio${visibleCount === 1 ? "" : "s"}`;

  const solicitadaAt =
    origin === "REQUESTED_CORRECTION"
      ? formatMesaAsesorReenviadoAt(
          input.cambioRequestAt ?? input.correctionRequestedAt,
        )
      : null;

  const loteAt = formatMesaAsesorReenviadoAt(
    origin === "ADVISOR_UPDATE"
      ? (displaySubmittedAt ?? input.ultimaCorreccionEnviadaAt)
      : changeDetails || loteVacio || input.historyConfidence === "EXACT"
        ? (displaySubmittedAt ?? input.ultimaCorreccionEnviadaAt)
        : (input.correctionResubmittedAt ?? input.ultimaCorreccionEnviadaAt),
  );

  const ctaLabel = firmadoHistorico
    ? MESA_CAMBIO_CTA_VER_CAMBIOS
    : mesaCambioCtaRevisarLabel(origin);

  return {
    showBlock,
    historica,
    firmadoHistorico,
    loteVacio,
    changeDetails,
    header,
    estadoPorRevisar: estadoPorRevisarOperativo,
    historicaFirmadoBadge: firmadoHistorico ? MESA_CAMBIO_HISTORICA_FIRMADO : null,
    advisorCopy: origin === "ADVISOR_UPDATE" ? MESA_CAMBIO_ADVISOR_COPY : null,
    ambiguousCopy: origin === "AMBIGUOUS" ? MESA_CAMBIO_AMBIGUOUS_COPY : null,
    legacyCopy: historica ? MESA_CAMBIO_LEGACY_COPY : null,
    historyBadge:
      input.historyConfidence === "EXACT"
        ? MESA_ASESOR_CAMBIOS_HISTORY_EXACT_BADGE
        : input.historyConfidence === "NO_DIFF"
          ? MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_BADGE
          : null,
    historyTitle:
      input.historyConfidence === "PARTIAL"
        ? MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_TITLE
        : null,
    historyBody:
      input.historyConfidence === "PARTIAL"
        ? MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_BODY
        : input.historyConfidence === "NO_DIFF"
          ? MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_BODY
          : null,
    historyDetail:
      input.historyConfidence === "PARTIAL"
        ? MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_DETAIL
        : input.historyConfidence === "NO_DIFF"
          ? MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_DETAIL
          : null,
    resumenLines,
    solicitadaAt,
    loteAt,
    tipoHumano:
      origin === "REQUESTED_CORRECTION"
        ? mesaCambioRequestTypeLabel(input.cambioRequestType)
        : null,
    solicitadaPor:
      origin === "REQUESTED_CORRECTION"
        ? String(input.correctionRequestedByName ?? "").trim() || null
        : null,
    nota:
      origin === "REQUESTED_CORRECTION"
        ? String(input.correctionRequestedNote ?? "").trim() || null
        : null,
    motivo:
      origin === "REQUESTED_CORRECTION"
        ? String(input.correctionRequestedReason ?? "").trim() || null
        : null,
    showRevisarCambios:
      !detalleNoDisponible &&
      !detalleLoading &&
      !detalleTemporalNoDisponible &&
      !batchMismatch &&
      hasMesaAsesorCambiosPanelContent({
        advisorChangeBatchId: displayBatchId ?? primaryCambioBatchId,
        advisorChangesCount: displayCount,
        historyConfidence: input.historyConfidence,
      }),
    showAbrirExpediente:
      historica ||
      loteVacio ||
      detalleNoDisponible ||
      detalleTemporalNoDisponible ||
      batchMismatch,
    ctaLabel,
    detalleLoading,
    detalleNoDisponible,
    detalleTemporalNoDisponible,
    batchMismatch,
  };
}

export {
  MESA_CAMBIO_CTA_REVISAR_CAMBIOS,
  MESA_CAMBIO_ESTADO_POR_REVISAR,
  mesaCambioFechaLoteLabel,
};
