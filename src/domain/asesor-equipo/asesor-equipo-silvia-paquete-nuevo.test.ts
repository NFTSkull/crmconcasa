import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSilviaPaqueteNuevoGate,
  parseAsesorEquipoSilviaPaqueteNuevoHabilitado,
} from "./asesor-equipo-silvia-paquete-nuevo";

describe("asesor-equipo-silvia-paquete-nuevo", () => {
  it("parse: solo true literal habilita", () => {
    assert.equal(parseAsesorEquipoSilviaPaqueteNuevoHabilitado(true), true);
    assert.equal(parseAsesorEquipoSilviaPaqueteNuevoHabilitado(false), false);
    assert.equal(parseAsesorEquipoSilviaPaqueteNuevoHabilitado("true"), false);
    assert.equal(parseAsesorEquipoSilviaPaqueteNuevoHabilitado(1), false);
    assert.equal(parseAsesorEquipoSilviaPaqueteNuevoHabilitado(null), false);
    assert.equal(parseAsesorEquipoSilviaPaqueteNuevoHabilitado(undefined), false);
  });

  it("gate: membresía Silvia ∧ switch ON", () => {
    assert.equal(
      isSilviaPaqueteNuevoGate({
        duenoEnEquipoSilvia: true,
        paqueteNuevoHabilitado: true,
      }),
      true,
    );
    assert.equal(
      isSilviaPaqueteNuevoGate({
        duenoEnEquipoSilvia: true,
        paqueteNuevoHabilitado: false,
      }),
      false,
    );
    assert.equal(
      isSilviaPaqueteNuevoGate({
        duenoEnEquipoSilvia: false,
        paqueteNuevoHabilitado: true,
      }),
      false,
    );
    assert.equal(
      isSilviaPaqueteNuevoGate({
        duenoEnEquipoSilvia: null,
        paqueteNuevoHabilitado: true,
      }),
      false,
    );
    assert.equal(
      isSilviaPaqueteNuevoGate({
        duenoEnEquipoSilvia: true,
        paqueteNuevoHabilitado: undefined,
      }),
      false,
    );
  });
});
