import test from "node:test";
import assert from "node:assert/strict";
import {
  isProgramaMejoravit,
  mapProgramaDbToUi,
  mapProgramaUiToDb,
} from "@/domain/expedientes/map-programa";

test("mapProgramaDbToUi: enum DB → labels UI", () => {
  assert.equal(mapProgramaDbToUi("mejoravit"), "Mejoravit");
  assert.equal(mapProgramaDbToUi("subcuenta"), "Subcuenta");
  assert.equal(mapProgramaDbToUi("compro_tu_casa"), "Compro tu casa");
});

test("mapProgramaUiToDb: labels UI → enum DB", () => {
  assert.equal(mapProgramaUiToDb("Mejoravit"), "mejoravit");
  assert.equal(mapProgramaUiToDb("Subcuenta"), "subcuenta");
  assert.equal(mapProgramaUiToDb("Compro tu casa"), "compro_tu_casa");
});

test("mapProgramaUiToDb ↔ mapProgramaDbToUi roundtrip", () => {
  const uiValues = ["Mejoravit", "Subcuenta", "Compro tu casa"] as const;
  for (const ui of uiValues) {
    assert.equal(mapProgramaDbToUi(mapProgramaUiToDb(ui)), ui);
  }
});

test("isProgramaMejoravit", () => {
  assert.equal(isProgramaMejoravit("Mejoravit"), true);
  assert.equal(isProgramaMejoravit("mejoravit"), true);
  assert.equal(isProgramaMejoravit("Compro tu casa"), false);
  assert.equal(isProgramaMejoravit("compro_tu_casa"), false);
});
