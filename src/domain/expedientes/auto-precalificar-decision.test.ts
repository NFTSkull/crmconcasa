import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideAutoPrecalFromScraper,
  isInfonavitSystemErrorMessage,
  montoFieldForPrograma,
  MOTIVO_NO_CUMPLE_CALIFICA_FALSE,
  parseSaldoSubcuenta,
  REASON_INFONAVIT_SYSTEM_ERROR,
  resolveProgramaParaMonto,
} from "./auto-precalificar-decision";

describe("auto-precalificar decision mapping", () => {
  it("parseSaldoSubcuenta quita comas", () => {
    assert.equal(parseSaldoSubcuenta("38,679.90"), 38679.9);
    assert.equal(parseSaldoSubcuenta(100), 100);
    assert.equal(parseSaldoSubcuenta(""), null);
  });

  it("montoFieldForPrograma por enum", () => {
    assert.equal(montoFieldForPrograma("mejoravit"), "saldoSubcuenta");
    assert.equal(montoFieldForPrograma("subcuenta"), "saldoSubcuenta");
    assert.equal(montoFieldForPrograma("compro_tu_casa"), "montoCredito");
    assert.equal(montoFieldForPrograma("otro"), null);
  });

  it("resolveProgramaParaMonto prioriza solicitado", () => {
    assert.equal(
      resolveProgramaParaMonto({
        programa: "compro_tu_casa",
        programaSolicitado: "mejoravit",
      }),
      "mejoravit",
    );
    assert.equal(
      resolveProgramaParaMonto({
        programa: "subcuenta",
        programaSolicitado: null,
      }),
      "subcuenta",
    );
  });

  it("mejoravit: califica true → aprobado con saldoSubcuenta", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: true,
        datos: {
          saldoSubcuenta: "38,679.90",
          montoCredito: "1,290,973.09",
        },
      },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, { kind: "aprobado", monto: 38679.9 });
  });

  it("subcuenta: califica true → aprobado con saldoSubcuenta", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: true,
        datos: {
          saldoSubcuenta: "12,345.67",
          montoCredito: "999,999.00",
        },
      },
      true,
      "subcuenta",
    );
    assert.deepEqual(d, { kind: "aprobado", monto: 12345.67 });
  });

  it("compro_tu_casa: califica true → aprobado con montoCredito", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: true,
        datos: {
          saldoSubcuenta: "189,051.68",
          montoCredito: "1,290,973.09",
        },
      },
      true,
      "compro_tu_casa",
    );
    assert.deepEqual(d, { kind: "aprobado", monto: 1290973.09 });
  });

  it("compro_tu_casa sin montoCredito → invalid_saldo", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: true,
        datos: { saldoSubcuenta: "189,051.68" },
      },
      true,
      "compro_tu_casa",
    );
    assert.deepEqual(d, { kind: "pending_error", reason: "invalid_saldo" });
  });

  it("programa null o desconocido → programa_desconocido (sin default)", () => {
    const payload = {
      califica: true as const,
      datos: { saldoSubcuenta: "189,051.68", montoCredito: "1,290,973.09" },
    };
    for (const programa of [null, undefined, "", "  ", "desconocido"]) {
      const d = decideAutoPrecalFromScraper(payload, true, programa);
      assert.deepEqual(d, {
        kind: "pending_error",
        reason: "programa_desconocido",
      });
    }
  });

  it("califica false → no_cumple con mensaje del scraper", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: false,
        mensaje: "SIN RELACION LABORAL VIGENTE",
        nss: "1",
      } as never,
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "no_cumple",
      motivo: "SIN RELACION LABORAL VIGENTE",
    });
  });

  it("califica false sin mensaje → no_cumple con fallback genérico", () => {
    const d = decideAutoPrecalFromScraper({ califica: false }, true, "mejoravit");
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
      } as never,
      true,
      "mejoravit",
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
      "mejoravit",
    );
    assert.equal(d.kind, "pending_error");
    if (d.kind === "pending_error") {
      assert.equal(d.reason, "ambiguous_payload");
    }
  });

  it("error scraper → pending", () => {
    const d = decideAutoPrecalFromScraper(
      { error: "timeout" },
      false,
      "mejoravit",
    );
    assert.deepEqual(d, { kind: "pending_error", reason: "scraper_failed" });
  });

  it("califica false + ERROR SISTEMA 923 → pending_error (no no_cumple)", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: false,
        mensaje: "ERROR EN EL SISTEMA. INTENTE MAS TARDE 923-",
      },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "pending_error",
      reason: REASON_INFONAVIT_SYSTEM_ERROR,
    });
  });

  it("mensaje técnico en minúsculas → pending_error", () => {
    const d = decideAutoPrecalFromScraper(
      {
        califica: false,
        mensaje: "error en el sistema. intente mas tarde 923-",
      },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "pending_error",
      reason: REASON_INFONAVIT_SYSTEM_ERROR,
    });
  });

  it("solo INTENTE MAS TARDE → pending_error", () => {
    const d = decideAutoPrecalFromScraper(
      { califica: false, mensaje: "INTENTE MAS TARDE" },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "pending_error",
      reason: REASON_INFONAVIT_SYSTEM_ERROR,
    });
  });

  it("INTENTA MAS TARDE (variante) → pending_error", () => {
    const d = decideAutoPrecalFromScraper(
      { califica: false, mensaje: "Por favor INTENTA MAS TARDE" },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "pending_error",
      reason: REASON_INFONAVIT_SYSTEM_ERROR,
    });
  });

  it("califica false + SIN APORTACIONES → no_cumple real", () => {
    const d = decideAutoPrecalFromScraper(
      { califica: false, mensaje: "SIN APORTACIONES EN LOS ULTIMOS MESES" },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "no_cumple",
      motivo: "SIN APORTACIONES EN LOS ULTIMOS MESES",
    });
  });

  it("califica false + CREDITO VIGENTE → no_cumple real", () => {
    const d = decideAutoPrecalFromScraper(
      { califica: false, mensaje: "CREDITO VIGENTE CON INFONAVIT" },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "no_cumple",
      motivo: "CREDITO VIGENTE CON INFONAVIT",
    });
  });

  it("success false + no_cumple_criterios + mensaje técnico → pending_error", () => {
    const d = decideAutoPrecalFromScraper(
      {
        success: false,
        razon: "no_cumple_criterios",
        mensaje: "ERROR EN EL SISTEMA. INTENTE MAS TARDE",
      },
      true,
      "mejoravit",
    );
    assert.deepEqual(d, {
      kind: "pending_error",
      reason: REASON_INFONAVIT_SYSTEM_ERROR,
    });
  });

  it("isInfonavitSystemErrorMessage: positivos y negativos", () => {
    assert.equal(
      isInfonavitSystemErrorMessage("ERROR EN EL SISTEMA. INTENTE MAS TARDE 923-"),
      true,
    );
    assert.equal(isInfonavitSystemErrorMessage("  error en el sistema  "), true);
    assert.equal(isInfonavitSystemErrorMessage("SIN APORTACIONES"), false);
    assert.equal(isInfonavitSystemErrorMessage("CREDITO VIGENTE"), false);
    assert.equal(isInfonavitSystemErrorMessage(""), false);
    assert.equal(isInfonavitSystemErrorMessage(null), false);
  });
});
