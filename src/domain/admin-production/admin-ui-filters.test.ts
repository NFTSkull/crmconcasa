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

describe("admin-ui-filters — Admin 10 pasos (sin Cita para firma)", () => {
  it("select muestra 10 pasos consecutivos sin «Cita para firma»", () => {
    const opts = opcionesFiltroPasoAdminDashboard();
    assert.equal(opts.length, 10);
    assert.deepEqual(
      opts.map((o) => o.value),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    );
    assert.ok(!opts.some((o) => /cita para firma/i.test(o.label)));
    assert.equal(opts[2]?.label, "3. Listo para cita de biométrico");
    assert.equal(opts[7]?.label, "8. Listo para agendar firma");
    assert.equal(opts[8]?.label, "9. Firmado");
    assert.equal(opts[9]?.label, "10. Pago a ConCasa");
  });

  it("Paso 3 → [3,4]; Paso 8 → [9,10]; Firmado/Pago", () => {
    assert.deepEqual(etapaActualesFromAdminPasoFilter("3"), [3, 4]);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("4"), [5]);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("8"), [9, 10]);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("9"), [11]);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("10"), [12]);
    assert.equal(etapaActualesFromAdminPasoFilter("todas"), null);
  });

  it("tarjeta interna 9 o 10 activa el mismo paso Admin 8", () => {
    assert.equal(nextPasoVisualFilterFromInternalCard("todas", 9), "8");
    assert.equal(nextPasoVisualFilterFromInternalCard("todas", 10), "8");
    assert.equal(nextPasoVisualFilterFromInternalCard("8", 9), "todas");
    assert.equal(isAdminPasoVisualFilterPressed("8", 9), true);
    assert.equal(isAdminPasoVisualFilterPressed("8", 10), true);
    assert.equal(isAdminPasoVisualFilterPressed("8", 11), false);
  });

  it("tarjeta interna 3 o 4 activa el mismo paso Admin 3 (P115)", () => {
    assert.equal(nextPasoVisualFilterFromInternalCard("todas", 3), "3");
    assert.equal(nextPasoVisualFilterFromInternalCard("todas", 4), "3");
    assert.equal(isAdminPasoVisualFilterPressed("3", 3), true);
    assert.equal(isAdminPasoVisualFilterPressed("3", 4), true);
  });

  it("etiqueta de filtro usa numeración Admin 1–10", () => {
    assert.match(labelPasoVisualAdminFilter("3") ?? "", /Paso 3 de 10/);
    assert.match(labelPasoVisualAdminFilter("8") ?? "", /Listo para agendar firma/);
    assert.equal(labelPasoVisualAdminFilter("todas"), null);
  });

  it("matchesAdminEtapaActualFilter respeta [9,10]", () => {
    assert.equal(
      matchesAdminEtapaActualFilter(9, { etapaActuales: [9, 10] }),
      true,
    );
    assert.equal(
      matchesAdminEtapaActualFilter(10, { etapaActuales: [9, 10] }),
      true,
    );
    assert.equal(
      matchesAdminEtapaActualFilter(11, { etapaActuales: [9, 10] }),
      false,
    );
  });
});
