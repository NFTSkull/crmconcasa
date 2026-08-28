import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideAutoPrecalFromScraper,
  MOTIVO_NO_CUMPLE_CALIFICA_FALSE,
  parseSaldoSubcuenta,
} from "./auto-precalificar-decision";

describe("auto-precalificar decision mapping", () => {
  it("parseSaldoSubcuenta quita comas", () => {
    assert.equal(parseSaldoSubcuenta("38,679.90"), 38679.9);
    assert.equal(parseSaldoSubcuenta(100), 100);
    assert.equal(parseSaldoSubcuenta(""), null);
  });

  it("califica true → aprobado con monto", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: true,
        datos: { saldoSubcuenta: "38,679.90" },
      },
      true,
    );
    assert.deepEqual(d, { kind: "aprobado", monto: 38679.9 });
  });

  it("califica false → no_cumple con mensaje del scraper", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: false,
        mensaje: "SIN RELACION LABORAL VIGENTE",
        nss: "1",
      } as never,
      true,
    );
    assert.deepEqual(d, {
      kind: "no_cumple",
      motivo: "SIN RELACION LABORAL VIGENTE",
    });
  });

  it("califica false sin mensaje → no_cumple con fallback genérico", () => {
    const d = decideAutoPrecalFromScraper({ califica: false }, true);
    assert.deepEqual(d, {
      kind: "no_cumple",
      motivo: MOTIVO_NO_CUMPLE_CALIFICA_FALSE,
    });
  });

  it("no_cumple_criterios + mensaje → no_cumple con texto exacto", () => {
    const mensaje =
      "No cumples con los criterios mínimos para obtener un crédito.";
    const d = decideAutoPrecalFromScraper(
      {
        success: false,
        razon: "no_cumple_criterios",
        mensaje,
        nss: "00000000012",
      },
      true,
    );
    assert.deepEqual(d, { kind: "no_cumple", motivo: mensaje });
  });

  it("no_cumple_criterios sin mensaje → pending", () => {
    const d = decideAutoPrecalFromScraper(
      {
        success: false,
        razon: "no_cumple_criterios",
      },
      true,
    );
    assert.equal(d.kind, "pending_error");
    if (d.kind === "pending_error") {
      assert.equal(d.reason, "ambiguous_payload");
    }
  });

  it("error scraper → pending", () => {
    const d = decideAutoPrecalFromScraper({ error: "timeout" }, false);
    assert.deepEqual(d, { kind: "pending_error", reason: "scraper_failed" });
  });
});
