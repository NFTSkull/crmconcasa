/**
 * P175 B1 — contratos domain (parser, classifier, detector, hora fija, aliases bio).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectInscripcionRebookRequirement } from "@/domain/agenda-inscripcion/detect-rebook";
import {
  INSCRIPCION_FIXED_TIME,
  INSCRIPCION_FIXED_TIME_DISPLAY,
} from "@/domain/agenda-inscripcion/constants";
import { fallbackReportGroupFromKind } from "@/domain/agenda-calendar/mesa-report-group";
import { formatMesaAgendaKind } from "@/lib/mesaAgendaCitasUi";
import { classifyNotificationResult } from "./operational-result-classifiers";
import { parseSheetSectionHeader } from "./parsers";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";
import {
  DEFAULT_BIOMETRICOS_TIME_ALIASES,
  resolveLogicalStartTime,
} from "./time-aliases";

describe("P175 B1 inscripcion domain contracts", () => {
  it("parser reconoce secciones MONTERREY/APODACA INSCRIPCION", () => {
    const mty = parseSheetSectionHeader("MONTERREY INSCRIPCION");
    assert.equal(mty.ok, true);
    if (mty.ok) {
      assert.deepEqual(mty.value, {
        sede: "monterrey",
        kind: "inscripcion",
      });
    }
    const apo = parseSheetSectionHeader("Apodaca Inscripción");
    assert.equal(apo.ok, true);
    if (apo.ok) {
      assert.deepEqual(apo.value, { sede: "apodaca", kind: "inscripcion" });
    }
  });

  it("fallbackReportGroupFromKind(inscripcion) → inscripcion", () => {
    assert.equal(fallbackReportGroupFromKind("inscripcion"), "inscripcion");
  });

  it("formatMesaAgendaKind(inscripcion) → Inscripción", () => {
    assert.equal(formatMesaAgendaKind("inscripcion"), "Inscripción");
  });

  it("classifier: REAGENDA INSCRIPCION → PENDING", () => {
    assert.equal(
      classifyNotificationResult("REAGENDA INSCRIPCION"),
      "PENDING",
    );
  });

  it("detector false negatives intactos", () => {
    assert.equal(detectInscripcionRebookRequirement("REAGENDA"), false);
    assert.equal(
      detectInscripcionRebookRequirement("REAGENDA BIOMETRICOS"),
      false,
    );
    assert.equal(detectInscripcionRebookRequirement("INSCRIPCION"), false);
    assert.equal(detectInscripcionRebookRequirement("BETTY"), false);
  });

  it("hora fija inscripción 11:00", () => {
    assert.equal(INSCRIPCION_FIXED_TIME, "11:00");
    assert.equal(INSCRIPCION_FIXED_TIME_DISPLAY, "11:00 AM");
  });

  it("aliases biométricos 11:00→10:00 siguen intactos", () => {
    const logical = resolveLogicalStartTime({
      aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
      locationId: "monterrey",
      kind: "biometricos",
      sheetStartTime: "11:00",
    });
    assert.equal(logical, "10:00");
  });

  it("inventory INSCRIPCION: 3×11:00 = capacity 3; 10:00 ignorada", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-20",
      sheetTitle: "20-AGO",
      sheetId: 99,
      grid: [
        ["MONTERREY INSCRIPCION"],
        ["11:00"],
        ["11:00", "111", "A", "Asesor"],
        ["11:00"],
        ["10:00"],
      ],
    });
    const insc = rows.filter((r) => r.kind === "inscripcion");
    assert.equal(insc.length, 3);
    assert.ok(insc.every((r) => r.sheetSlotTime === "11:00"));
    assert.ok(insc.every((r) => r.slotTime === "11:00"));
    assert.equal(insc.filter((r) => r.status === "available").length, 2);
    assert.equal(insc.filter((r) => r.status === "occupied_external").length, 1);
    assert.ok(
      issues.some(
        (i) =>
          i.code === "UNPARSED_TIME_IN_SECTION" && i.message.includes("10:00"),
      ),
    );
  });

  it("inventory INSCRIPCION vacío → 0 slots", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-20",
      sheetTitle: "20-AGO",
      sheetId: 99,
      grid: [["MONTERREY INSCRIPCION"], ["APODACA BIOMETRICOS"], ["08:00"]],
    });
    assert.equal(rows.filter((r) => r.kind === "inscripcion").length, 0);
  });
});
