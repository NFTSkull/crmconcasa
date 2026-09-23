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

  it("rango con guion VIGENCIA 2024 - 2034 → año final", () => {
    assert.equal(
      parseExplicitIneValidityYear("VIGENCIA 2024 - 2034"),
      2034,
    );
  });

  it("rango con slash VIGENCIA 2024/2034 → año final", () => {
    assert.equal(
      parseExplicitIneValidityYear("VIGENCIA 2024/2034"),
      2034,
    );
  });

  it("rango con espacio VIGENCIA 2024 2034 → año final", () => {
    assert.equal(
      parseExplicitIneValidityYear("VIGENCIA 2024 2034"),
      2034,
    );
  });

  it("OCR con columnas desordenadas conserva el año final 2035", () => {
    const text = [
      "MEGM790219HCSNZG01",
      "VIGENCIA",
      "‘|",
      "y",
      "FECHA DE NACIMIENTO — SECCIÓN",
      "(0)",
      "19/02/1979",
      "2380",
      "2025 2035",
    ].join("\n");

    assert.equal(parseExplicitIneValidityYear(text), 2035);
    const result = evaluateIneValidity({ frontText: text, now: NOW });
    assert.equal(result.status, "valid");
    assert.equal(result.expirationYear, 2035);
    assert.equal(result.canAutoReject, false);
  });

  it("año único VIGENCIA 2034 → 2034", () => {
    assert.equal(parseExplicitIneValidityYear("VIGENCIA 2034"), 2034);
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
    assert.equal(result.displayVigencia, "2026");
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

  it("año único vencido no se auto-rechaza porque puede ser inicio de rango truncado", () => {
    const result = evaluateIneValidity({
      frontText: "VIGENCIA 2025",
      now: NOW,
    });
    assert.equal(result.status, "expired");
    assert.equal(result.expirationYear, 2025);
    assert.equal(result.canAutoReject, false);
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
    assert.equal(result.displayVigencia, "2025");
    assert.equal(result.canAutoReject, true);
  });

  it("MRZ tolera saltos de línea, > y confusiones numéricas comunes", () => {
    const reverse = [
      "IDMEX2840877688",
      ">>2653O7623357O<",
      "88O1O3OM",
      "2512311",
      "MEX<02<<<<<<<<<<",
    ].join("\n");

    assert.equal(parseIneMrzT7Number(reverse), "2653076233570");
    assert.equal(parseIneMrzValidityDate(reverse), "2025-12-31");
  });

  it("MRZ recupera T7 aunque Tesseract parta IDMEX y el prefijo en varias líneas", () => {
    const reverse = [
      "IDMEX22",
      "2197692",
      "4<<1786018292055",
      "6309141H3112319MEX<04<<22078<7",
      "CHAIRES<RODRIGUEZ<<RAUL<<<<<<<",
    ].join("\n");

    assert.equal(parseIneMrzT7Number(reverse), "1786018292055");
    assert.equal(parseIneMrzValidityDate(reverse), "2031-12-31");
  });

  it("T7 verificado por consenso manda aunque una lectura cruda difiera", () => {
    const reverse = [
      "IDMEX2930763080<<3049078375316",
      "INE_T7_VERIFIED 3049078375310",
    ].join("\n");
    assert.equal(parseIneMrzT7Number(reverse), "3049078375310");
  });

  it("T7 con lecturas discrepantes falla cerrado y no adivina el último dígito", () => {
    const reverse = [
      "IDMEX2930763080<<3049078375316",
      "IDMEX2930763080<<3049078375310",
      "INE_T7_UNVERIFIED",
    ].join("\n");
    assert.equal(parseIneMrzT7Number(reverse), null);
  });

  it("texto MRZ sin marcador solo acepta un único T7 estructural", () => {
    assert.equal(
      parseIneMrzT7Number(
        "IDMEX2930763080<<3049078375310\nCARDENAS<BLANCO<<JORGE<DAVID",
      ),
      "3049078375310",
    );
    assert.equal(
      parseIneMrzT7Number(
        [
          "IDMEX2930763080<<3049078375316",
          "IDMEX2930763080<<3049078375310",
        ].join("\n"),
      ),
      null,
    );
  });

  it("MRZ compara la fecha exacta contra el día actual", () => {
    const reverse = [
      "IDMEX2840877688<<2653076233570",
      "8801030M2609171MEX<02<<<<<<<<<<",
    ].join("\n");
    const result = evaluateIneValidity({ reverseText: reverse, now: NOW });
    assert.equal(result.status, "expired");
    assert.equal(result.displayVigencia, "2026");
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
