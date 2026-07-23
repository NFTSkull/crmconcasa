import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  etapaActualesFromAdminPasoFilter,
  isAdminPasoVisualFilterPressed,
  labelPasoVisualAdminFilter,
  mesaPageAfterEtapaChange,
  nextEtapaFilterFromCard,
  nextPasoVisualFilterFromInternalCard,
  opcionesFiltroPasoAdminDashboard,
  pagesAfterAsesorChange,
} from "./admin-ui-filters";
import { matchesAdminEtapaActualFilter } from "./repo";

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

describe("admin-ui-filters — P115 pasos visuales Admin", () => {
  it("select general muestra exactamente 11 pasos (sin 12 internas)", () => {
    const opts = opcionesFiltroPasoAdminDashboard();
    assert.equal(opts.length, 11);
    assert.deepEqual(
      opts.map((o) => o.value),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
    );
    assert.ok(!opts.some((o) => o.label.includes("Cita agendada (biométricos)")));
    assert.equal(opts[2]?.label, "3. Listo para cita de biométrico");
    assert.equal(opts[10]?.label, "11. Pago a ConCasa");
  });

  it("Paso 3 filtra internas 3 y 4", () => {
    assert.deepEqual(etapaActualesFromAdminPasoFilter("3"), [3, 4]);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("4"), [5]);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("11"), [12]);
    assert.equal(etapaActualesFromAdminPasoFilter("todas"), null);
  });

  it("tarjeta interna 3 o 4 activa el mismo paso visual 3", () => {
    assert.equal(nextPasoVisualFilterFromInternalCard("todas", 3), "3");
    assert.equal(nextPasoVisualFilterFromInternalCard("todas", 4), "3");
    assert.equal(nextPasoVisualFilterFromInternalCard("3", 3), "todas");
    assert.equal(nextPasoVisualFilterFromInternalCard("3", 4), "todas");
    assert.equal(isAdminPasoVisualFilterPressed("3", 3), true);
    assert.equal(isAdminPasoVisualFilterPressed("3", 4), true);
    assert.equal(isAdminPasoVisualFilterPressed("3", 5), false);
  });

  it("etiqueta de filtro usa numeración visual", () => {
    assert.match(labelPasoVisualAdminFilter("3") ?? "", /Paso 3 de 11/);
    assert.equal(labelPasoVisualAdminFilter("todas"), null);
  });

  it("matchesAdminEtapaActualFilter respeta [3,4]", () => {
    assert.equal(
      matchesAdminEtapaActualFilter(3, { etapaActuales: [3, 4] }),
      true,
    );
    assert.equal(
      matchesAdminEtapaActualFilter(4, { etapaActuales: [3, 4] }),
      true,
    );
    assert.equal(
      matchesAdminEtapaActualFilter(5, { etapaActuales: [3, 4] }),
      false,
    );
  });
});
