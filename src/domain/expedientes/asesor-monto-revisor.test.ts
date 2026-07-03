import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asesorPuedeIntegrarTrasMontoRevisor,
  estatusPrecalificacionDesdeEditor,
} from "./mock.repo";

describe("asesorPuedeIntegrarTrasMontoRevisor", () => {
  it("true con monto > 0 aunque decision sea no_cumple", () => {
    assert.equal(
      asesorPuedeIntegrarTrasMontoRevisor({
        decision: "no_cumple",
        monto_aprobado: 100,
        notas_revision: "",
      }),
      true,
    );
  });

  it("true con aprobado y monto > 0", () => {
    assert.equal(
      asesorPuedeIntegrarTrasMontoRevisor({
        decision: "aprobado",
        monto_aprobado: 100,
        notas_revision: "",
      }),
      true,
    );
  });

  it("false con monto 0 o null", () => {
    assert.equal(
      asesorPuedeIntegrarTrasMontoRevisor({
        decision: "aprobado",
        monto_aprobado: 0,
        notas_revision: "",
      }),
      false,
    );
    assert.equal(
      asesorPuedeIntegrarTrasMontoRevisor({
        decision: "no_cumple",
        monto_aprobado: null,
        notas_revision: "",
      }),
      false,
    );
  });

  it("false con pendiente sin monto", () => {
    assert.equal(
      asesorPuedeIntegrarTrasMontoRevisor({
        decision: "pendiente",
        monto_aprobado: null,
        notas_revision: "",
      }),
      false,
    );
  });
});

describe("estatusPrecalificacionDesdeEditor", () => {
  it("mapea decisión del editor", () => {
    assert.equal(
      estatusPrecalificacionDesdeEditor({
        decision: "pendiente",
        monto_aprobado: null,
        notas_revision: "",
      }),
      "pendiente",
    );
    assert.equal(
      estatusPrecalificacionDesdeEditor({
        decision: "no_cumple",
        monto_aprobado: null,
        notas_revision: "",
      }),
      "rechazado",
    );
    assert.equal(
      estatusPrecalificacionDesdeEditor({
        decision: "aprobado",
        monto_aprobado: null,
        notas_revision: "",
      }),
      "aprobado",
    );
  });
});
