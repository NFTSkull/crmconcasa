import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MSJ_INFONAVIT_GUARDA_DATOS_ANTES_ENVIO,
  bloqueaEnvioInfonavitPorCambiosSinGuardar,
} from "./infonavit-envio-gate";

describe("P189 B3 infonavit-envio-gate", () => {
  it("Mejoravit con cambios sin guardar bloquea envío inicial", () => {
    assert.equal(
      bloqueaEnvioInfonavitPorCambiosSinGuardar({
        programaDb: "mejoravit",
        hasUnsavedClienteDatos: true,
        p189SnapshotRelevant: true,
      }),
      true,
    );
  });

  it("Mejoravit con cambios sin guardar bloquea reingreso", () => {
    assert.equal(
      bloqueaEnvioInfonavitPorCambiosSinGuardar({
        programaDb: "mejoravit",
        hasUnsavedClienteDatos: true,
        p189SnapshotRelevant: true,
      }),
      true,
    );
    assert.match(MSJ_INFONAVIT_GUARDA_DATOS_ANTES_ENVIO, /Guarda primero los Datos Generales/);
  });

  it("Mejoravit guardado y completo no bloquea por unsaved", () => {
    assert.equal(
      bloqueaEnvioInfonavitPorCambiosSinGuardar({
        programaDb: "mejoravit",
        hasUnsavedClienteDatos: false,
      }),
      false,
    );
  });

  it("FLAG OFF / legacy no bloquea por unsaved P189", () => {
    assert.equal(
      bloqueaEnvioInfonavitPorCambiosSinGuardar({
        programaDb: "mejoravit",
        hasUnsavedClienteDatos: true,
        p189SnapshotRelevant: false,
      }),
      false,
    );
  });

  it("otros programas no cambian aunque haya unsaved", () => {
    assert.equal(
      bloqueaEnvioInfonavitPorCambiosSinGuardar({
        programaDb: "compro_tu_casa",
        hasUnsavedClienteDatos: true,
      }),
      false,
    );
    assert.equal(
      bloqueaEnvioInfonavitPorCambiosSinGuardar({
        programaDb: "subcuenta",
        hasUnsavedClienteDatos: true,
      }),
      false,
    );
  });
});
