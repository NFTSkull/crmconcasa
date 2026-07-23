import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMesaActualizadoPorLine,
  formatMesaVistoPorLine,
} from "./mesaExpedienteActividadUi";

describe("mesaExpedienteActividadUi", () => {
  it("vacío muestra textos canónicos", () => {
    assert.equal(formatMesaVistoPorLine({}), "Sin registro de vista");
    assert.equal(
      formatMesaActualizadoPorLine({}),
      "Sin actualización de Mesa registrada",
    );
  });

  it("con nombre y fecha muestra línea compacta", () => {
    const visto = formatMesaVistoPorLine({
      lastViewedByName: "Jorge",
      lastViewedAt: "2026-07-23T22:30:00.000Z",
    });
    assert.match(visto, /^Visto por Jorge · /);
    const act = formatMesaActualizadoPorLine({
      lastUpdatedByName: "Sara",
      lastUpdatedAt: "2026-07-23T22:35:00.000Z",
    });
    assert.match(act, /^Actualizado por Sara · /);
  });
});
