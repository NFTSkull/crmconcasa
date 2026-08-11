import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  classifyBiometricResult,
  classifyNotificationResult,
  classifySignatureResult,
  formatSignatureResultRaw,
} from "./operational-result-classifiers";
import {
  buildOperationalResultUpsertRows,
  countCompletedOperational,
} from "./operational-results";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";

describe("operational-result-classifiers — biométricos", () => {
  it("1. CESI MTY → completed", () => {
    assert.equal(classifyBiometricResult("CESI MTY"), "COMPLETED");
  });

  it("3. X → failed", () => {
    assert.equal(classifyBiometricResult("X"), "FAILED_OR_NOT_ATTENDED");
  });

  it("4. vacío → pending", () => {
    assert.equal(classifyBiometricResult(""), "PENDING");
  });
});

describe("operational-result-classifiers — notificación", () => {
  it("BETTY / YA CON BETTY / SI → completed", () => {
    assert.equal(classifyNotificationResult("BETTY"), "COMPLETED");
    assert.equal(classifyNotificationResult("YA CON BETTY"), "COMPLETED");
    assert.equal(classifyNotificationResult("SI"), "COMPLETED");
  });

  it("X → failed", () => {
    assert.equal(classifyNotificationResult("X"), "FAILED_OR_NOT_ATTENDED");
  });
});

describe("operational-result-classifiers — firmas (FIRMO canónico)", () => {
  it("1. FIRMO=SI, FIRMA vacío → COMPLETED", () => {
    assert.equal(classifySignatureResult("SI", ""), "COMPLETED");
    assert.equal(formatSignatureResultRaw("SI", ""), "SI");
  });

  it("2. FIRMO=SI, FIRMA=BETTY → COMPLETED", () => {
    assert.equal(classifySignatureResult("SI", "BETTY"), "COMPLETED");
  });

  it("3. FIRMO=SI, FIRMA=CESI MTY → COMPLETED", () => {
    assert.equal(classifySignatureResult("SI", "CESI MTY"), "COMPLETED");
  });

  it("4. FIRMO=X → no completed", () => {
    assert.equal(classifySignatureResult("X", ""), "FAILED_OR_NOT_ATTENDED");
    assert.equal(classifySignatureResult("X", "X"), "FAILED_OR_NOT_ATTENDED");
  });

  it("5. FIRMO=NO → no completed", () => {
    assert.equal(classifySignatureResult("NO", ""), "FAILED_OR_NOT_ATTENDED");
  });

  it("6. REAGENDA → no completed", () => {
    assert.equal(
      classifySignatureResult("REAGENDA FIRMA, FALLA SISTEMA", ""),
      "FAILED_OR_NOT_ATTENDED",
    );
  });

  it("7. YA CON BETTY → pending", () => {
    assert.equal(classifySignatureResult("YA CON BETTY", ""), "PENDING");
  });

  it("8. vacío → pending", () => {
    assert.equal(classifySignatureResult("", ""), "PENDING");
    assert.equal(classifySignatureResult(null, null), "PENDING");
  });

  it("9. COMPLETO en notas + FIRMO no SI → no completed", () => {
    assert.notEqual(classifySignatureResult("YA CON BETTY", ""), "COMPLETED");
    assert.notEqual(classifySignatureResult("COMPLETO ✔", ""), "COMPLETED");
    assert.notEqual(classifySignatureResult("", "COMPLETO ✔"), "COMPLETED");
  });
});

describe("operational-results — firmas reporting vs inventario", () => {
  const org = "00000000-0000-4000-8000-000000000001";

  it("10. FIRMO=SI + hora null dentro de bloque firmas → completed Bernardo", () => {
    const rows = buildOperationalResultUpsertRows({
      organizationId: org,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "11 AGOSTO",
      bookingDate: "2026-08-11",
      grid: [
        ["MONTERREY FIRMAS"],
        ["HORA", "", "", "", "NOTIFICACION", "FIRMO", "FIRMA"],
        ["9:00", "1", "Cliente A", "Asesor", "BETTY", "SI", ""],
        ["", "2", "Cliente B", "Asesor", "BETTY", "SI", ""],
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.slot_time, "09:00");
    assert.equal(rows[1]?.slot_time, null);
    assert.equal(rows[1]?.signature_result_class, "COMPLETED");
    assert.equal(
      countCompletedOperational({ rows, metric: "firmas" }),
      2,
    );
  });

  it("11. hora null NO crea slot/inventario", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      sheetId: 1,
      sheetTitle: "11 AGOSTO",
      bookingDate: "2026-08-11",
      grid: [
        ["MONTERREY FIRMAS"],
        ["HORA", "NSS", "NOMBRE", "ASESOR", "NOTIFICACION", "FIRMO", "FIRMA"],
        ["9:00", "1", "Cliente A", "Asesor", "BETTY", "SI", ""],
        ["", "2", "Cliente B", "Asesor", "BETTY", "SI", ""],
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sheetSlotTime, "09:00");
  });

  it("12. KPI Firmas == detail (fixture 15 SI)", () => {
    const pairs = Array.from({ length: 15 }, (_, i) => [
      i < 13 ? "9:00" : "",
      String(1000 + i),
      `Cliente ${i}`,
      "Asesor",
      "BETTY",
      "SI",
      "",
    ]);
    const grid = [
      ["MONTERREY FIRMAS"],
      ["HORA", "", "", "", "NOTIFICACION", "FIRMO", "FIRMA"],
      ...pairs,
    ];
    const rows = buildOperationalResultUpsertRows({
      organizationId: org,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "11 AGOSTO",
      bookingDate: "2026-08-11",
      grid,
    });
    const kpi = countCompletedOperational({ rows, metric: "firmas" });
    const detail = rows.filter(
      (r) => r.kind === "firmas" && r.signature_result_class === "COMPLETED",
    );
    assert.equal(kpi, 15);
    assert.equal(detail.length, kpi);
  });

  it("13–15. Bio / Notificaciones / Ingresos fuentes intactas", () => {
    assert.equal(classifyBiometricResult("CESI MTY"), "COMPLETED");
    assert.equal(classifyNotificationResult("BETTY 1"), "COMPLETED");
    const loadSrc = readFileSync(
      join(process.cwd(), "src/lib/adminBernardoLoad.ts"),
      "utf8",
    );
    assert.match(loadSrc, /ingresosTotal: summary\.enviadosAMesa/);
    assert.match(loadSrc, /bernardo_ops_detail/);
    assert.doesNotMatch(loadSrc, /get_mesa_agenda_bookings/);
  });

  it("deltas SI↔X cambian KPI Firmas ±1", () => {
    const base = [
      ["MONTERREY FIRMAS"],
      ["HORA", "", "", "", "NOTIFICACION", "FIRMO", "FIRMA"],
      ["9:00", "1", "A", "B", "BETTY", "SI", ""],
    ];
    const mk = (grid: string[][]) =>
      buildOperationalResultUpsertRows({
        organizationId: org,
        spreadsheetId: "ss",
        sheetId: 1,
        sheetTitle: "11 AGOSTO",
        bookingDate: "2026-08-11",
        grid,
      });
    assert.equal(countCompletedOperational({ rows: mk(base), metric: "firmas" }), 1);
    const down = base.map((r) => [...r]);
    down[2] = ["9:00", "1", "A", "B", "BETTY", "X", ""];
    assert.equal(countCompletedOperational({ rows: mk(down), metric: "firmas" }), 0);
    const up = base.map((r) => [...r]);
    up[2] = ["9:00", "1", "A", "B", "BETTY", "SI", "BETTY"];
    assert.equal(countCompletedOperational({ rows: mk(up), metric: "firmas" }), 1);
  });
});
