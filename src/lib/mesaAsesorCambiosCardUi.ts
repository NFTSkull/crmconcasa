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
  type MesaAsesorCambiosSummaryItem,
  visibleAdvisorChangesCount,
} from "@/lib/mesaAsesorCambiosUi";
import {
  MESA_CAMBIO_ADVISOR_COPY,
  MESA_CAMBIO_AMBIGUOUS_COPY,
  MESA_CAMBIO_ESTADO_POR_REVISAR,
  MESA_CAMBIO_LEGACY_COPY,
  mesaCambioFechaLoteLabel,
  mesaCambioMuestraEstadoPorRevisar,
  mesaCambioOrigenBadge,
  mesaCambioRequestTypeLabel,
  type MesaCambioRevisionOrigen,
} from "@/lib/mesaCambiosRevisionOrigenUi";

export type MesaAsesorCambiosCardInput = Readonly<{
  origin?: MesaCambioRevisionOrigen | null;
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
  loteVacio: boolean;
  changeDetails: boolean;
  header: string;
  estadoPorRevisar: boolean;
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

export function buildMesaAsesorCambiosCardModel(
  input: MesaAsesorCambiosCardInput,
): MesaAsesorCambiosCardModel {
  const origin = input.origin ?? null;
  const visibleCount = visibleAdvisorChangesCount({
    advisorChangesCount: input.advisorChangesCount,
    historyConfidence: input.historyConfidence,
  });
  const changeDetails = hasAdvisorChangeDetails({
    advisorChangeBatchId: input.advisorChangeBatchId,
    advisorChangesCount: input.advisorChangesCount,
    historyConfidence: input.historyConfidence,
  });
  const loteVacio =
    Boolean(input.advisorChangeBatchId) &&
    (input.advisorChangesCount ?? 0) <= 0 &&
    input.historyConfidence !== "EXACT";
  const historica =
    input.resumenDocumental === "correccion_enviada" &&
    !input.advisorChangeBatchId;
  const labels = previewLabels(
    input.advisorChangesPreview,
    input.advisorChangesSummary,
  );
  const resumenLines = formatMesaAsesorCambiosResumen(labels, visibleCount);
  const hasSummary = changeDetails || labels.length > 0 || loteVacio;
  const showBlock =
    input.resumenDocumental === "correccion_enviada" || hasSummary || loteVacio;

  const header = origin
    ? `${mesaCambioOrigenBadge(origin)} · ${visibleCount} cambio${visibleCount === 1 ? "" : "s"}`
    : `${visibleCount} cambio${visibleCount === 1 ? "" : "s"}`;

  return {
    showBlock,
    historica,
    loteVacio,
    changeDetails,
    header,
    estadoPorRevisar: mesaCambioMuestraEstadoPorRevisar(origin),
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
    solicitadaAt: formatMesaAsesorReenviadoAt(
      input.cambioRequestAt ?? input.correctionRequestedAt,
    ),
    loteAt: formatMesaAsesorReenviadoAt(
      changeDetails || loteVacio || input.historyConfidence === "EXACT"
        ? (input.advisorChangesSubmittedAt ?? input.ultimaCorreccionEnviadaAt)
        : (input.correctionResubmittedAt ?? input.ultimaCorreccionEnviadaAt),
    ),
    tipoHumano: mesaCambioRequestTypeLabel(input.cambioRequestType),
    solicitadaPor: String(input.correctionRequestedByName ?? "").trim() || null,
    nota: String(input.correctionRequestedNote ?? "").trim() || null,
    motivo: String(input.correctionRequestedReason ?? "").trim() || null,
    showRevisarCambios: hasMesaAsesorCambiosPanelContent({
      advisorChangeBatchId: input.advisorChangeBatchId,
      advisorChangesCount: input.advisorChangesCount,
      historyConfidence: input.historyConfidence,
    }),
    showAbrirExpediente: historica || loteVacio,
  };
}

export { MESA_CAMBIO_ESTADO_POR_REVISAR, mesaCambioFechaLoteLabel };
