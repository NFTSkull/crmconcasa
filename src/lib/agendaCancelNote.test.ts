import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAsesorCitaCanceladaPorMesaMessage,
  parseCancelMotivoFromNote,
  validateMesaCancelMotivo,
} from "./agendaCancelNote";

describe("parseCancelMotivoFromNote", () => {
  it("extrae motivo de línea Cancelado:", () => {
    assert.equal(
      parseCancelMotivoFromNote("Nota previa\nCancelado: Cliente no pudo asistir"),
      "Cliente no pudo asistir",
    );
  });

  it("null si no hay motivo", () => {
    assert.equal(parseCancelMotivoFromNote(null), null);
    assert.equal(parseCancelMotivoFromNote("solo nota"), null);
  });
});

describe("validateMesaCancelMotivo", () => {
  it("motivo obligatorio", () => {
    assert.equal(validateMesaCancelMotivo(""), "El motivo para el asesor es obligatorio.");
    assert.equal(validateMesaCancelMotivo("   "), "El motivo para el asesor es obligatorio.");
    assert.equal(validateMesaCancelMotivo("Cliente no pudo asistir"), null);
  });
});

describe("formatAsesorCitaCanceladaPorMesaMessage", () => {
  it("incluye motivo cuando existe", () => {
    const msg = formatAsesorCitaCanceladaPorMesaMessage("Error en sede");
    assert.match(msg, /Cita cancelada por Mesa/);
    assert.match(msg, /Error en sede/);
    assert.match(msg, /reagendar/);
  });
});
