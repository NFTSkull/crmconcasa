import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminStageHistoryPageSchema,
  adminStageHistorySummarySchema,
  ADMIN_STAGE_HISTORY_ALL_PASO_VALUES,
  buildAdminStageHistoryRpcPayload,
  canConsultAdminStageHistory,
  canShowAdminStageCohortOutcomes,
  cohortEtapaCuadra,
  formatDurationSeconds,
  labelAdminStageCohortOutcome,
  labelAdminStageCohortSituacion,
  labelAdminStageHistoryResultado,
  validateAdminStageHistoryFechaRango,
  validateAdminStageHistoryPasos,
  type AdminStageHistorySummary,
} from "./types";

const ASESOR = "11111111-1111-4111-8111-111111111111";

const sampleSummary: AdminStageHistorySummary = {
  totales: {
    total_expedientes_unicos: 2,
    total_visitas: 3,
    entered_count: 3,
    advanced_count: 1,
    current_count: 1,
    rejected_count: 1,
    returned_count: 0,
    avg_duration_seconds: 86400,
    median_duration_seconds: 72000,
  },
  resumen_por_etapa: [
    {
      paso_visual: 3,
      paso_nombre: "Listo para cita de biométrico",
      entered_count: 2,
      advanced_count: 1,
      current_count: 0,
      rejected_count: 0,
      returned_count: 0,
      visitas: 2,
      expedientes_unicos: 2,
      avg_duration_seconds: 3600,
      median_duration_seconds: 3600,
      tasa_avance: 50,
      tasa_pendiente: 0,
    },
  ],
  generated_at: "2026-08-01T12:00:00.000Z",
  history_coverage_from: "2026-06-15T08:00:00.000Z",
  movimiento: "entrada",
  nota: "Historial exacto",
};

describe("admin-stage-history — validación y payload", () => {
  it("valida pasos 1–11", () => {
    assert.equal(validateAdminStageHistoryPasos([1, 11]).ok, true);
    assert.equal(validateAdminStageHistoryPasos([0]).ok, false);
  });

  it("valida rango de fechas", () => {
    assert.equal(validateAdminStageHistoryFechaRango(null, null).ok, true);
    assert.equal(
      validateAdminStageHistoryFechaRango("2026-07-01", "2026-07-10").ok,
      true,
    );
    assert.equal(
      validateAdminStageHistoryFechaRango("2026-07-10", "2026-07-01").ok,
      false,
    );
  });

  it("consulta exige asesores+pasos; fechas salvo estado_actual", () => {
    const base = {
      asesorIds: [ASESOR],
      pasosVisuales: [3],
      estadoActual: "todos" as const,
      fechaDesde: null,
      fechaHasta: null,
      buscar: null,
    };
    assert.equal(
      canConsultAdminStageHistory({ ...base, movimiento: "entrada" }),
      false,
    );
    assert.equal(
      canConsultAdminStageHistory({
        ...base,
        movimiento: "entrada",
        fechaDesde: "2026-07-01",
        fechaHasta: "2026-07-15",
      }),
      true,
    );
    assert.equal(
      canConsultAdminStageHistory({ ...base, movimiento: "estado_actual" }),
      true,
    );
    assert.equal(
      canConsultAdminStageHistory({
        asesorIds: [],
        pasosVisuales: [3],
        movimiento: "estado_actual",
        estadoActual: "todos",
        fechaDesde: null,
        fechaHasta: null,
        buscar: null,
      }),
      false,
    );
  });

  it("payload RPC mapea filtros", () => {
    assert.deepEqual(
      buildAdminStageHistoryRpcPayload({
        asesorIds: [ASESOR],
        pasosVisuales: [3, 6],
        movimiento: "avance",
        estadoActual: "activos",
        fechaDesde: "2026-07-01",
        fechaHasta: "2026-07-15",
        buscar: "  cliente  ",
      }),
      {
        p_asesor_ids: [ASESOR],
        p_pasos_visuales: [3, 6],
        p_movimiento: "avance",
        p_fecha_desde: "2026-07-01",
        p_fecha_hasta: "2026-07-15",
        p_estado_actual: "activos",
        p_buscar: "cliente",
      },
    );
    assert.deepEqual(
      buildAdminStageHistoryRpcPayload({
        asesorIds: [ASESOR],
        pasosVisuales: [3],
        movimiento: "estado_actual",
        estadoActual: "todos",
        fechaDesde: "2026-07-01",
        fechaHasta: "2026-07-15",
        buscar: null,
      }).p_fecha_desde,
      null,
    );
  });

  it("Todas selecciona 11 pasos", () => {
    assert.equal(ADMIN_STAGE_HISTORY_ALL_PASO_VALUES.length, 11);
  });

  it("Zod acepta summary y page", () => {
    assert.equal(adminStageHistorySummarySchema.safeParse(sampleSummary).success, true);
    assert.equal(
      adminStageHistoryPageSchema.safeParse({
        items: [
          {
            visita_id: "33333333-3333-4333-8333-333333333333",
            expediente_id: "44444444-4444-4444-8444-444444444444",
            cliente_nombre: "Cliente",
            nss: "****7890",
            asesor_nombre: "Asesor",
            paso_visual: 3,
            paso_nombre: "Bio",
            entered_at: "2026-07-01T15:00:00.000Z",
            exited_at: null,
            duration_seconds: 3600,
            resultado: "continua",
          },
        ],
        total: 1,
        page: 1,
        page_size: 25,
        history_coverage_from: "2026-06-15T08:00:00.000Z",
        movimiento: "entrada",
      }).success,
      true,
    );
  });

  it("formatea duración y resultado", () => {
    assert.equal(formatDurationSeconds(86400), "1d 0h");
    assert.equal(formatDurationSeconds(null), "—");
    assert.equal(labelAdminStageHistoryResultado("avanzo"), "Avanzó");
  });

  it("cohorte: requiere etapas + rango; cuadre de categorías", () => {
    const base = {
      asesorIds: [ASESOR],
      pasosVisuales: [2] as number[],
      movimiento: "entrada" as const,
      estadoActual: "todos" as const,
      fechaDesde: "2026-08-01",
      fechaHasta: "2026-08-07",
      buscar: null as string | null,
    };
    assert.equal(canShowAdminStageCohortOutcomes(base), true);
    assert.equal(
      canShowAdminStageCohortOutcomes({
        ...base,
        fechaDesde: null,
        fechaHasta: null,
      }),
      false,
    );
    assert.equal(
      cohortEtapaCuadra({
        paso_visual: 2,
        etapa_label: "Registro",
        entered_count: 40,
        advanced_count: 28,
        stayed_count: 9,
        incident_count: 3,
        undetermined_count: 0,
        advance_rate: 70,
        stayed_rate: 22.5,
        avg_advance_duration_seconds: 3600,
        median_advance_duration_seconds: 3000,
      }),
      true,
    );
    assert.equal(labelAdminStageCohortOutcome("stayed"), "Se quedaron al cierre");
    assert.match(
      labelAdminStageCohortSituacion("avanzo_despues"),
      /después del periodo/i,
    );
  });
});
