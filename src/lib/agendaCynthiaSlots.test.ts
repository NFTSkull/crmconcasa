import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CYNTHIA_STANDARD_WORKDAY_SLOTS,
  mergeAgendaSlotTimes,
  removeAgendaSlotTime,
  sortHhmmSlotTimes,
  tryAddManualSlotTime,
} from "./agendaCynthiaSlots";

describe("mergeAgendaSlotTimes", () => {
  it("agrega horario rápido sin duplicar", () => {
    const merged = mergeAgendaSlotTimes(["09:00"], ["15:00", "09:00"]);
    assert.deepEqual(merged, ["09:00", "15:00"]);
  });

  it("ordena horarios ascendente", () => {
    const merged = mergeAgendaSlotTimes([], ["17:00", "09:00", "12:00"]);
    assert.deepEqual(merged, ["09:00", "12:00", "17:00"]);
  });

  it("jornada estándar no duplica existentes", () => {
    const merged = mergeAgendaSlotTimes(["10:00", "14:00"], CYNTHIA_STANDARD_WORKDAY_SLOTS);
    assert.deepEqual(merged, [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ]);
  });
});

describe("tryAddManualSlotTime", () => {
  it("input vacío no es error de validación", () => {
    assert.deepEqual(tryAddManualSlotTime("", ["09:00"]), { kind: "empty" });
    assert.deepEqual(tryAddManualSlotTime("   ", ["09:00"]), { kind: "empty" });
  });

  it("normaliza 9:00 a 09:00", () => {
    const result = tryAddManualSlotTime("9:00", []);
    assert.equal(result.kind, "added");
    if (result.kind === "added") {
      assert.equal(result.slot, "09:00");
      assert.deepEqual(result.slots, ["09:00"]);
    }
  });

  it("rechaza formato inválido solo al intentar agregar", () => {
    assert.deepEqual(tryAddManualSlotTime("25:99", []), { kind: "invalid" });
    assert.deepEqual(tryAddManualSlotTime("abc", []), { kind: "invalid" });
  });

  it("detecta duplicado en manual", () => {
    assert.deepEqual(tryAddManualSlotTime("09:00", ["09:00"]), {
      kind: "duplicate",
      slot: "09:00",
    });
  });

  it("agrega horario personalizado válido", () => {
    const result = tryAddManualSlotTime("13:30", ["09:00"]);
    assert.equal(result.kind, "added");
    if (result.kind === "added") {
      assert.equal(result.slot, "13:30");
      assert.deepEqual(result.slots, ["09:00", "13:30"]);
    }
  });
});

describe("removeAgendaSlotTime", () => {
  it("elimina horario de la lista", () => {
    assert.deepEqual(removeAgendaSlotTime(["09:00", "10:00", "14:00"], "10:00"), [
      "09:00",
      "14:00",
    ]);
  });
});

describe("sortHhmmSlotTimes", () => {
  it("deduplica y ordena", () => {
    assert.deepEqual(sortHhmmSlotTimes(["14:00", "09:00", "09:00", "10:00"]), [
      "09:00",
      "10:00",
      "14:00",
    ]);
  });
});
