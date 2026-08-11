import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPagoConcasaEtapaBadge,
  isPagoConcasaResultado,
  labelPagoConcasaResultado,
  labelPagoConcasaResultadoConCheck,
  MESA_PAGO_CONCASA_DECISION_COPY,
  normalizePagoConcasaResultado,
} from "./pago-concasa-resultado";

describe("pago-concasa-resultado", () => {
  it("normaliza y valida", () => {
    assert.equal(normalizePagoConcasaResultado("pagado"), "pagado");
    assert.equal(normalizePagoConcasaResultado("NO_PAGADO"), "no_pagado");
    assert.equal(normalizePagoConcasaResultado("x"), null);
    assert.equal(isPagoConcasaResultado("pagado"), true);
    assert.equal(isPagoConcasaResultado("rechazado"), false);
  });

  it("labels amigables (sin nombres técnicos)", () => {
    assert.equal(labelPagoConcasaResultado("pagado"), "Pagó");
    assert.equal(labelPagoConcasaResultado("no_pagado"), "No pagó");
    assert.equal(labelPagoConcasaResultadoConCheck("pagado"), "✓ Pagó");
    assert.equal(formatPagoConcasaEtapaBadge("pagado"), "Pago ConCasa · Pagó");
    assert.equal(
      formatPagoConcasaEtapaBadge("no_pagado"),
      "Pago ConCasa · No pagó",
    );
    assert.equal(formatPagoConcasaEtapaBadge(null), "Pago ConCasa");
  });

  it("copy Mesa: dos decisiones y aviso no bancario", () => {
    assert.equal(MESA_PAGO_CONCASA_DECISION_COPY.botonPagado, "Sí pagó");
    assert.equal(MESA_PAGO_CONCASA_DECISION_COPY.botonNoPagado, "No pagó");
    assert.match(MESA_PAGO_CONCASA_DECISION_COPY.confirmPagado, /sí realizó/);
    assert.match(MESA_PAGO_CONCASA_DECISION_COPY.confirmNoPagado, /no realizó/);
    assert.match(
      MESA_PAGO_CONCASA_DECISION_COPY.avisoCierre,
      /No registra movimientos bancarios/,
    );
  });
});
