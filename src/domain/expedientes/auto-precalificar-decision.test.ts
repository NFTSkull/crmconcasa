import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideAutoPrecalFromScraper,
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

  it("califica false → no_cumple", () => {
    const d = decideAutoPrecalFromScraper(
      { califica: false, mensaje: "SIN APORTACIONES", nss: "1" } as never,
      true,
    );
    assert.deepEqual(d, { kind: "no_cumple" });
  });

  it("no_cumple_criterios sin califica → pending (no auto-rechazo)", () => {
    const d = decideAutoPrecalFromScraper(
      {
        success: false,
        razon: "no_cumple_criterios",
        mensaje: "criterios",
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
