import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMesaAgendaSedeLabel, MESA_GESTIONAR_CANCELAR_CONTINUAR_STOP } from "./mesaAgendaCitasUi";

describe("formatMesaAgendaSedeLabel (P118)", () => {
  it("null / vacío → Sin sede", () => {
    assert.equal(formatMesaAgendaSedeLabel(null), "Sin sede");
    assert.equal(formatMesaAgendaSedeLabel(undefined), "Sin sede");
    assert.equal(formatMesaAgendaSedeLabel(""), "Sin sede");
    assert.equal(formatMesaAgendaSedeLabel("   "), "Sin sede");
  });

  it("sentinel notificacion → Sin sede (nunca como sede)", () => {
    assert.equal(formatMesaAgendaSedeLabel("notificacion"), "Sin sede");
    assert.equal(formatMesaAgendaSedeLabel("Notificacion"), "Sin sede");
  });

  it("mapea Cynthia / legacy a Monterrey o Apodaca", () => {
    assert.equal(formatMesaAgendaSedeLabel("monterrey"), "Monterrey");
    assert.equal(formatMesaAgendaSedeLabel("apodaca"), "Apodaca");
    assert.equal(formatMesaAgendaSedeLabel("mty-centro"), "Monterrey");
    assert.equal(formatMesaAgendaSedeLabel("sede-centro"), "Monterrey");
    assert.equal(formatMesaAgendaSedeLabel("san-nicolas"), "Apodaca");
  });

  it("capitaliza id legible si no mapea", () => {
    assert.equal(formatMesaAgendaSedeLabel("sede-avanzar"), "Sede Avanzar");
  });

  it("basura sin letras → Sin sede", () => {
    assert.equal(formatMesaAgendaSedeLabel("---"), "Sin sede");
    assert.equal(formatMesaAgendaSedeLabel("12345"), "Sin sede");
  });
});

describe("MESA_GESTIONAR_CANCELAR_CONTINUAR_STOP (P118)", () => {
  it("copy STOP visible para UI", () => {
    assert.equal(
      MESA_GESTIONAR_CANCELAR_CONTINUAR_STOP,
      "Requiere RPC dedicada (no disponible)",
    );
  });
});
