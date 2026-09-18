import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateIneValidity,
  parseExplicitIneValidityYear,
  parseIneMrzT7Number,
  parseIneMrzValidityDate,
  parseIneMrzValidityYear,
} from "./ine-validity";

const NOW = new Date("2026-09-18T17:17:00-06:00");

describe("INE validity", () => {
  it("usa el segundo año de VIGENCIA como expiración", () => {
    assert.equal(
      parseExplicitIneValidityYear("VIGENCIA 2016 - 2026"),
      2026,
    );
  });

  it("tolera O por cero dentro del bloque VIGENCIA", () => {
    assert.equal(
      parseExplicitIneValidityYear("VIGENCIA 2O16 - 2O26"),
      2026,
    );
  });

  it("INE con vigencia del año actual sigue vigente hasta el cierre del año", () => {
    const result = evaluateIneValidity({
      frontText: "VIGENCIA 2016-2026",
      now: NOW,
    });
    assert.equal(result.status, "valid");
    assert.equal(result.displayVigencia, "31/12/2026");
    assert.equal(result.canAutoReject, false);
  });

  it("INE con vigencia de un año anterior se puede auto-rechazar", () => {
    const result = evaluateIneValidity({
      frontText: "VIGENCIA 2015 2025",
      now: NOW,
    });
    assert.equal(result.status, "expired");
    assert.equal(result.expirationYear, 2025);
    assert.equal(result.canAutoReject, true);
    assert.equal(result.source, "front_explicit");
  });

  it("vigencia futura permanece válida", () => {
    const result = evaluateIneValidity({
      frontText: "VIGENCIA: 2034",
      now: NOW,
    });
    assert.equal(result.status, "valid");
    assert.equal(result.canAutoReject, false);
  });

  it("MRZ sin T7 sirve como respaldo pero no auto-rechaza", () => {
    const reverse =
      "IDMEX0000000000<<<<<<<<<<<<<<<\n9001010F2512317MEX<<<<<<<<<<<8";
    assert.equal(parseIneMrzValidityYear(reverse), 2025);
    const result = evaluateIneValidity({ reverseText: reverse, now: NOW });
    assert.equal(result.status, "expired");
    assert.equal(result.source, "reverse_mrz");
    assert.equal(result.canAutoReject, false);
  });

  it("MRZ con T7 + fecha vencida permite rechazo automático seguro", () => {
    const reverse = [
      "IDMEX2840877688<<2653076233570",
      "8801030M2512311MEX<02<<<<<<<<<<",
      "CARRASCO<MIJANGOS<<ANAHI<<<<<<",
    ].join("\n");

    assert.equal(parseIneMrzT7Number(reverse), "2653076233570");
    assert.equal(parseIneMrzValidityDate(reverse), "2025-12-31");
    const result = evaluateIneValidity({ reverseText: reverse, now: NOW });
    assert.equal(result.status, "expired");
    assert.equal(result.displayVigencia, "31/12/2025");
    assert.equal(result.canAutoReject, true);
  });

  it("MRZ compara la fecha exacta contra el día actual", () => {
    const reverse = [
      "IDMEX2840877688<<2653076233570",
      "8801030M2609171MEX<02<<<<<<<<<<",
    ].join("\n");
    const result = evaluateIneValidity({ reverseText: reverse, now: NOW });
    assert.equal(result.status, "expired");
    assert.equal(result.displayVigencia, "17/09/2026");
    assert.equal(result.canAutoReject, true);
  });

  it("sin vigencia legible no rechaza", () => {
    const result = evaluateIneValidity({
      frontText: "INSTITUTO NACIONAL ELECTORAL",
      reverseText: "TEXTO BORROSO",
      now: NOW,
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.canAutoReject, false);
  });
});
