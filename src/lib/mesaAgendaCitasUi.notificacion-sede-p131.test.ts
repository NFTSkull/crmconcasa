import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMesaAgendaSedeLabel,
  MESA_NOTIFICACION_SEDE_ASSIGN_LABEL,
  needsMesaNotificacionSedeAssignment,
} from "./mesaAgendaCitasUi";

describe("P131 notificacion sede assignment UI", () => {
  it("monterrey/apodaca no necesitan asignación", () => {
    assert.equal(needsMesaNotificacionSedeAssignment("notificacion", "monterrey"), false);
    assert.equal(needsMesaNotificacionSedeAssignment("notificacion", "apodaca"), false);
    assert.equal(formatMesaAgendaSedeLabel("monterrey"), "Monterrey");
    assert.equal(formatMesaAgendaSedeLabel("apodaca"), "Apodaca");
  });

  it("notificacion/NULL necesitan Asignar sede", () => {
    assert.equal(needsMesaNotificacionSedeAssignment("notificacion", "notificacion"), true);
    assert.equal(needsMesaNotificacionSedeAssignment("notificacion", null), true);
    assert.equal(needsMesaNotificacionSedeAssignment("notificacion", ""), true);
    assert.equal(MESA_NOTIFICACION_SEDE_ASSIGN_LABEL, "Asignar sede");
  });

  it("otros kinds no disparan asignación", () => {
    assert.equal(needsMesaNotificacionSedeAssignment("biometricos", null), false);
    assert.equal(needsMesaNotificacionSedeAssignment("firmas", "notificacion"), false);
  });

  it("legacy estructurado no necesita control (label canónico)", () => {
    assert.equal(needsMesaNotificacionSedeAssignment("notificacion", "mty-centro"), false);
    assert.equal(formatMesaAgendaSedeLabel("mty-centro"), "Monterrey");
  });
});
