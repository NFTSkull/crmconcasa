import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mesaPageAfterEtapaChange,
  nextEtapaFilterFromCard,
  pagesAfterAsesorChange,
} from "./admin-ui-filters";

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
