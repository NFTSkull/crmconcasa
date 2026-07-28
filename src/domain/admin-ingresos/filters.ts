import type { IngresosEstadoFiltro, IngresosFilters, IngresosStageScope } from "./types";
import type { IngresosPeriodPreset } from "./period";

export type IngresosFilterUiState = Readonly<{
  preset: IngresosPeriodPreset;
  customFrom: string;
  customTo: string;
  selectedAsesorIds: readonly string[];
  stageScope: IngresosStageScope;
  visibleStep: number | null;
  montoFuente: IngresosFilters["montoFuente"];
  porcentajes: readonly number[];
  estado: IngresosEstadoFiltro;
  buscar: string;
  page: number;
}>;

export const INGRESOS_DEFAULT_FILTER_UI: IngresosFilterUiState = Object.freeze({
  preset: "mes_actual",
  customFrom: "",
  customTo: "",
  selectedAsesorIds: [],
  stageScope: "all_submitted",
  visibleStep: null,
  montoFuente: "todas",
  porcentajes: [],
  estado: "elegibles",
  buscar: "",
  page: 1,
});

export function isIngresosFilterUiDefault(state: IngresosFilterUiState): boolean {
  return (
    state.preset === INGRESOS_DEFAULT_FILTER_UI.preset &&
    state.customFrom === "" &&
    state.customTo === "" &&
    state.selectedAsesorIds.length === 0 &&
    state.stageScope === "all_submitted" &&
    state.visibleStep == null &&
    state.montoFuente === "todas" &&
    state.porcentajes.length === 0 &&
    state.estado === "elegibles" &&
    state.buscar.trim() === "" &&
    state.page === 1
  );
}

export function resetIngresosFilterUi(): IngresosFilterUiState {
  return { ...INGRESOS_DEFAULT_FILTER_UI, selectedAsesorIds: [], porcentajes: [] };
}

export function buildIngresosAlcanceSummary(params: {
  stageScope: IngresosStageScope;
  visibleStep: number | null;
  pasoLabel?: string | null;
}): string {
  if (params.stageScope === "all_submitted" || params.visibleStep == null) {
    return "Mostrando todos los expedientes enviados a Mesa con datos de cobro válidos.";
  }
  const label = params.pasoLabel?.trim() || `Paso ${params.visibleStep}`;
  if (params.stageScope === "from_step") {
    return `Mostrando expedientes desde ${label} en adelante.`;
  }
  return `Mostrando únicamente ${label}.`;
}
