import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProduccionAsesorFilters,
  fetchProduccionAsesorPlan,
  mesaPageAfterEtapaChange,
  nextEtapaFilterFromCard,
  pagesAfterAsesorChange,
  planProduccionAsesorFetch,
  produccionAsesorOptionsKey,
  produccionAsesorProductionKey,
} from "./admin-ui-filters";
import { resolveAdminPeriodBounds } from "./period";
import type { AdminAsesorProductionRow, AdminProductionFilters } from "./repo";

describe("admin-ui-filters — navegación etapa/asesor", () => {
  it("toggle de tarjeta: aplica y limpia etapa", () => {
    assert.equal(nextEtapaFilterFromCard("todas", 2), "2");
    assert.equal(nextEtapaFilterFromCard("2", 2), "todas");
    assert.equal(nextEtapaFilterFromCard("2", 5), "5");
  });

  it("reinicia paginación de expedientes al cambiar etapa", () => {
    assert.equal(mesaPageAfterEtapaChange(), 1);
  });

  it("reinicia ambas paginaciones al cambiar asesor", () => {
    assert.deepEqual(pagesAfterAsesorChange(), { mesaPage: 1, precalPage: 1 });
  });
});

describe("admin-ui-filters — producción por asesor desacoplada", () => {
  it("solo incluye periodo, estado y asesor; ignora etapa/buscar/precal", () => {
    const bounds = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-01",
      customToInclusive: "2026-07-17",
    });
    const filters = buildProduccionAsesorFilters({
      bounds,
      asesorId: "11111111-1111-4111-8111-111111111111",
      estado: "activos",
    });
    assert.equal(filters.bounds, bounds);
    assert.equal(filters.asesorId, "11111111-1111-4111-8111-111111111111");
    assert.equal(filters.estado, "activos");
    assert.equal(filters.etapaActual, null);
    assert.equal(filters.buscar, null);
    assert.equal(filters.precalDecision, null);
  });

  it("sin asesor deja asesorId null (lista todos del periodo)", () => {
    const bounds = resolveAdminPeriodBounds({ preset: "hoy" });
    const filters = buildProduccionAsesorFilters({
      bounds,
      asesorId: null,
      estado: "todos",
    });
    assert.equal(filters.asesorId, null);
    assert.equal(filters.estado, "todos");
  });
});

describe("P086 — dedupe listByAsesor (plan + spy)", () => {
  const asesorA = "11111111-1111-4111-8111-111111111111";
  const boundsHoy = resolveAdminPeriodBounds({
    preset: "hoy",
    now: new Date("2026-07-17T18:00:00.000Z"),
  });
  const boundsMes = resolveAdminPeriodBounds({
    preset: "mes",
    now: new Date("2026-07-17T18:00:00.000Z"),
  });

  function spyListByAsesor() {
    const calls: AdminProductionFilters[] = [];
    const listByAsesor = async (filters: AdminProductionFilters) => {
      calls.push(filters);
      const row: AdminAsesorProductionRow = {
        asesorId: filters.asesorId ?? "all",
        asesorNombre: "Spy",
        asesorEmail: null,
        enviadosAMesa: 1,
        precalificacionesAprobadas: 0,
        precalificacionesNoCumple: 0,
        aprobadasMayorA20000: 0,
        montoAprobadoTotal: 0,
        etapas: {},
      };
      return [row];
    };
    return { calls, listByAsesor };
  }

  /**
   * Auditoría B2.3.1 (antes → objetivo):
   * | Escenario                      | Antes | Objetivo |
   * | Montaje sin asesor             | 2     | 1        |
   * | Montaje con asesor             | 2     | ≤2       |
   * | Cambio etapa/buscar/precal     | 0     | 0        |
   * | Periodo sin asesor             | 2     | 1        |
   * | Periodo con asesor             | 2     | ≤2       |
   * | Cambio asesor (opts vigentes)  | 2     | 1        |
   */

  it("montaje sin asesor: 1 llamada compartida (tabla = opciones)", async () => {
    const { calls, listByAsesor } = spyListByAsesor();
    const plan = planProduccionAsesorFetch({
      bounds: boundsHoy,
      estado: "todos",
      asesorId: null,
      optionsKeyLoaded: null,
    });
    assert.equal(plan.mode, "shared");
    const result = await fetchProduccionAsesorPlan(plan, listByAsesor);
    assert.equal(calls.length, 1);
    assert.equal(result.listByAsesorCalls, 1);
    assert.equal(result.asesores, result.asesorOptions);
    assert.equal(calls[0]?.asesorId, null);
  });

  it("montaje con asesor: 2 llamadas (filtrada + opciones)", async () => {
    const { calls, listByAsesor } = spyListByAsesor();
    const plan = planProduccionAsesorFetch({
      bounds: boundsHoy,
      estado: "todos",
      asesorId: asesorA,
      optionsKeyLoaded: null,
    });
    assert.equal(plan.mode, "table_and_options");
    const result = await fetchProduccionAsesorPlan(plan, listByAsesor);
    assert.equal(calls.length, 2);
    assert.equal(result.listByAsesorCalls, 2);
    assert.equal(calls[0]?.asesorId, asesorA);
    assert.equal(calls[1]?.asesorId, null);
  });

  it("cambio de periodo sin asesor: 1 llamada", async () => {
    const { calls, listByAsesor } = spyListByAsesor();
    const prevKey = produccionAsesorOptionsKey(boundsHoy, "todos");
    const plan = planProduccionAsesorFetch({
      bounds: boundsMes,
      estado: "todos",
      asesorId: null,
      optionsKeyLoaded: prevKey,
    });
    const result = await fetchProduccionAsesorPlan(plan, listByAsesor);
    assert.equal(plan.mode, "shared");
    assert.equal(result.listByAsesorCalls, 1);
    assert.equal(calls.length, 1);
  });

  it("cambio de periodo con asesor: 2 llamadas máximo", async () => {
    const { calls, listByAsesor } = spyListByAsesor();
    const prevKey = produccionAsesorOptionsKey(boundsHoy, "todos");
    const plan = planProduccionAsesorFetch({
      bounds: boundsMes,
      estado: "todos",
      asesorId: asesorA,
      optionsKeyLoaded: prevKey,
    });
    const result = await fetchProduccionAsesorPlan(plan, listByAsesor);
    assert.equal(plan.mode, "table_and_options");
    assert.ok(result.listByAsesorCalls <= 2);
    assert.equal(calls.length, 2);
  });

  it("cambio de asesor con opciones vigentes: 1 llamada filtrada", async () => {
    const { calls, listByAsesor } = spyListByAsesor();
    const optionsKey = produccionAsesorOptionsKey(boundsHoy, "todos");
    const plan = planProduccionAsesorFetch({
      bounds: boundsHoy,
      estado: "todos",
      asesorId: asesorA,
      optionsKeyLoaded: optionsKey,
    });
    assert.equal(plan.mode, "table_only");
    const result = await fetchProduccionAsesorPlan(plan, listByAsesor);
    assert.equal(result.listByAsesorCalls, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.asesorId, asesorA);
    assert.equal(result.asesorOptions, null);
    assert.equal(result.nextOptionsKey, null);
  });

  it("keys: optionsKey ignora asesor; productionKey lo incluye", () => {
    const o1 = produccionAsesorOptionsKey(boundsHoy, "todos");
    const o2 = produccionAsesorOptionsKey(boundsHoy, "todos");
    const oEstado = produccionAsesorOptionsKey(boundsHoy, "activos");
    assert.equal(o1, o2);
    assert.notEqual(o1, oEstado);

    const pAll = produccionAsesorProductionKey(boundsHoy, "todos", null);
    const pA = produccionAsesorProductionKey(boundsHoy, "todos", asesorA);
    assert.notEqual(pAll, pA);
    assert.ok(pA.startsWith(o1));
  });

  it("etapa/buscar/precal no forman parte de las keys de producción", () => {
    const key = produccionAsesorProductionKey(boundsHoy, "todos", null);
    assert.equal(key.includes("etapa"), false);
    assert.equal(key.includes("buscar"), false);
    assert.equal(key.includes("precal"), false);
    // Simula: cambiar etapa no cambia optionsKey ni productionKey
    assert.equal(
      produccionAsesorOptionsKey(boundsHoy, "todos"),
      produccionAsesorOptionsKey(boundsHoy, "todos"),
    );
  });

  it("periodos distintos de Hoy usan fromIso/toExclusiveIso en optionsKey", () => {
    const semana = resolveAdminPeriodBounds({
      preset: "semana",
      now: new Date("2026-07-17T18:00:00.000Z"),
    });
    const mes = resolveAdminPeriodBounds({
      preset: "mes",
      now: new Date("2026-07-17T18:00:00.000Z"),
    });
    const personalizado = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-06-01",
      customToInclusive: "2026-06-30",
    });
    for (const bounds of [semana, mes, personalizado]) {
      const key = produccionAsesorOptionsKey(bounds, "todos");
      assert.ok(key.startsWith(`${bounds.fromIso}|${bounds.toExclusiveIso}|`));
      assert.notEqual(bounds.fromIso, boundsHoy.fromIso);
    }
  });
});
