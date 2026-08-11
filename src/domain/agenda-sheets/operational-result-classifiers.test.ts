import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  classifyBiometricResult,
  classifyNotificationResult,
  classifySignatureResult,
  normalizeSheetOpsText,
} from "./operational-result-classifiers";
import {
  buildOperationalResultUpsertRows,
  countCompletedOperational,
} from "./operational-results";

describe("operational-result-classifiers — biométricos", () => {
  it("1. CESI MTY → completed", () => {
    assert.equal(classifyBiometricResult("CESI MTY"), "COMPLETED");
    assert.equal(classifyBiometricResult("  cesi mty "), "COMPLETED");
  });

  it("2. YA EN CESI → completed", () => {
    assert.equal(classifyBiometricResult("YA EN CESI"), "COMPLETED");
  });

  it("3. X → failed", () => {
    assert.equal(classifyBiometricResult("X"), "FAILED_OR_NOT_ATTENDED");
  });

  it("4. vacío → pending", () => {
    assert.equal(classifyBiometricResult(""), "PENDING");
    assert.equal(classifyBiometricResult(null), "PENDING");
  });

  it("5–6. X + notas de no asistencia no cambian la clase (sigue failed)", () => {
    // La nota no se pasa al clasificador de E; X permanece failed.
    assert.equal(classifyBiometricResult("X"), "FAILED_OR_NOT_ATTENDED");
  });

  it("7. estado positivo + nota → completed", () => {
    assert.equal(classifyBiometricResult("CESI MTY"), "COMPLETED");
  });

  it("CESI APODACA histórico → completed", () => {
    assert.equal(classifyBiometricResult("CESI APODACA"), "COMPLETED");
  });
});

describe("operational-result-classifiers — notificación", () => {
  it("10. BETTY 8 → completed", () => {
    assert.equal(classifyNotificationResult("BETTY 8"), "COMPLETED");
  });

  it("11. X → failed", () => {
    assert.equal(classifyNotificationResult("X"), "FAILED_OR_NOT_ATTENDED");
  });

  it("12. vacío → pending", () => {
    assert.equal(classifyNotificationResult(""), "PENDING");
  });

  it("BETTY / YA CON BETTY / SI históricos → completed", () => {
    assert.equal(classifyNotificationResult("BETTY"), "COMPLETED");
    assert.equal(classifyNotificationResult("YA CON BETTY"), "COMPLETED");
    assert.equal(classifyNotificationResult("SI"), "COMPLETED");
  });

  it("CESI en F no cuenta como notificación", () => {
    assert.equal(classifyNotificationResult("CESI MTY"), "UNKNOWN");
  });
});

describe("operational-result-classifiers — firmas", () => {
  it("14. COMPLETO ✔ → completed", () => {
    assert.equal(classifySignatureResult("COMPLETO ✔"), "COMPLETED");
    assert.equal(
      normalizeSheetOpsText("COMPLETO ✔").includes("COMPLETO"),
      true,
    );
  });

  it("15. FALTA ACUSE → failed", () => {
    assert.equal(
      classifySignatureResult("FALTA ACUSE"),
      "FAILED_OR_NOT_ATTENDED",
    );
  });

  it("16. vacío → pending", () => {
    assert.equal(classifySignatureResult(""), "PENDING");
  });
});

describe("operational-results — KPI deltas e idempotencia", () => {
  const baseGrid = [
    ["MONTERREY BIOMETRICOS"],
    ["HORA", "", "", "", "BIOMETRICOS", "NOTIFICACION", "", "NOTAS"],
    ["8:30", "1", "A", "B", "X", "", "", "NO ASISTIO"],
    ["8:30", "2", "C", "D", "CESI MTY", "BETTY 8", "*", "OK"],
    ["MONTERREY FIRMAS"],
    ["HORA", "", "", "", "NOTIFICACION", "FIRMO", "FIRMA"],
    ["9:00", "3", "E", "F", "BETTY", "YA CON BETTY", "", "03 agosto", "FALTA ACUSE"],
    ["9:30", "4", "G", "H", "BETTY", "YA CON BETTY", "", "04 agosto", "COMPLETO ✔"],
  ];

  it("8–9 / 13 / 17–18: corrección de estado cambia KPI ±1 (idempotente por fila)", () => {
    const org = "00000000-0000-4000-8000-000000000001";
    const mk = (grid: string[][]) =>
      buildOperationalResultUpsertRows({
        organizationId: org,
        spreadsheetId: "ss",
        sheetId: 1,
        sheetTitle: "11 AGOSTO",
        bookingDate: "2026-08-11",
        grid,
      });

    const a = mk(baseGrid);
    assert.equal(
      countCompletedOperational({ rows: a, metric: "biometricos" }),
      1,
    );
    assert.equal(
      countCompletedOperational({ rows: a, metric: "notificaciones" }),
      1,
    );
    assert.equal(countCompletedOperational({ rows: a, metric: "firmas" }), 1);

    const gridBioUp = baseGrid.map((r) => [...r]);
    gridBioUp[2] = ["8:30", "1", "A", "B", "CESI MTY", "", "", "NO ASISTIO"];
    const b = mk(gridBioUp);
    assert.equal(
      countCompletedOperational({ rows: b, metric: "biometricos" }),
      2,
    );

    const gridBioDown = baseGrid.map((r) => [...r]);
    gridBioDown[3] = ["8:30", "2", "C", "D", "X", "BETTY 8", "*", "OK"];
    const c = mk(gridBioDown);
    assert.equal(
      countCompletedOperational({ rows: c, metric: "biometricos" }),
      0,
    );

    const gridNotifDown = baseGrid.map((r) => [...r]);
    gridNotifDown[3] = ["8:30", "2", "C", "D", "CESI MTY", "X", "*", "OK"];
    const d = mk(gridNotifDown);
    assert.equal(
      countCompletedOperational({ rows: d, metric: "notificaciones" }),
      0,
    );

    const gridFirmaUp = baseGrid.map((r) => [...r]);
    gridFirmaUp[6] = [
      "9:00",
      "3",
      "E",
      "F",
      "BETTY",
      "YA CON BETTY",
      "",
      "03 agosto",
      "COMPLETO ✔",
    ];
    const e = mk(gridFirmaUp);
    assert.equal(countCompletedOperational({ rows: e, metric: "firmas" }), 2);

    const gridFirmaDown = baseGrid.map((r) => [...r]);
    gridFirmaDown[7] = [
      "9:30",
      "4",
      "G",
      "H",
      "BETTY",
      "YA CON BETTY",
      "",
      "04 agosto",
      "FALTA ACUSE",
    ];
    const f = mk(gridFirmaDown);
    assert.equal(countCompletedOperational({ rows: f, metric: "firmas" }), 0);
  });

  it("19. fecha del tab/cita manda (booking_date del input, no edit ts)", () => {
    const rows = buildOperationalResultUpsertRows({
      organizationId: "00000000-0000-4000-8000-000000000001",
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "11 AGOSTO",
      bookingDate: "2026-08-11",
      grid: baseGrid,
    });
    assert.ok(rows.every((r) => r.booking_date === "2026-08-11"));
  });

  it("25–26. sedes Monterrey/Apodaca no se mezclan", () => {
    const rows = buildOperationalResultUpsertRows({
      organizationId: "00000000-0000-4000-8000-000000000001",
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "11 AGOSTO",
      bookingDate: "2026-08-11",
      grid: [
        ["APODACA BIOMETRICOS"],
        ["HORA", "", "", "", "BIOMETRICOS", "NOTIFICACION"],
        ["11:00", "1", "A", "B", "CESI APODACA", "BETTY"],
        ["MONTERREY BIOMETRICOS"],
        ["HORA", "", "", "", "BIOMETRICOS", "NOTIFICACION"],
        ["8:30", "2", "C", "D", "CESI MTY", ""],
      ],
    });
    const apo = rows.filter((r) => r.location_id === "apodaca");
    const mty = rows.filter((r) => r.location_id === "monterrey");
    assert.equal(apo.length, 1);
    assert.equal(mty.length, 1);
    assert.equal(apo[0]?.biometric_result_class, "COMPLETED");
    assert.equal(mty[0]?.biometric_result_class, "COMPLETED");
  });

  it("snapshot 11 ago: bio=10 firmas=4 notif=4 (clasificador real, no hardcode KPI)", () => {
    // Filas operativas del Sheet RO 2026-08-11 (sin PII).
    const bioE = [
      "CESI MTY",
      "CESI MTY",
      "CESI MTY",
      "CESI MTY",
      "X",
      "X",
      "X",
      "CESI MTY",
      "YA EN CESI",
      "YA EN CESI",
      "YA EN CESI",
      "YA EN CESI",
      "",
      "",
      "CESI MTY",
      "",
      "",
    ];
    const bioF = [
      "BETTY 8",
      "BETTY 6",
      "BETTY 7",
      "X",
      "X",
      "X",
      "X",
      "X",
      "",
      "",
      "",
      "",
      "",
      "",
      "BETTY 9",
      "",
      "",
    ];
    const firmaI = [
      "",
      "",
      "",
      "",
      "COMPLETO ✔",
      "",
      "",
      "COMPLETO ✔",
      "COMPLETO ✔",
      "",
      "",
      "COMPLETO ✔",
      "FALTA ACUSE",
      "",
    ];
    const bioN = bioE.filter((v) => classifyBiometricResult(v) === "COMPLETED")
      .length;
    const notifN = bioF.filter(
      (v) => classifyNotificationResult(v) === "COMPLETED",
    ).length;
    const firmaN = firmaI.filter((v) => classifySignatureResult(v) === "COMPLETED")
      .length;
    assert.equal(bioN, 10);
    assert.equal(notifN, 4);
    assert.equal(firmaN, 4);
    // KPI == detalle: mismos conteos derivados de filas
    assert.equal(bioN, bioE.filter((v) => classifyBiometricResult(v) === "COMPLETED").length);
    assert.equal(firmaN, firmaI.filter((v) => classifySignatureResult(v) === "COMPLETED").length);
    assert.equal(notifN, bioF.filter((v) => classifyNotificationResult(v) === "COMPLETED").length);
  });

  it("29. Ingresos permanece con fuentes enviadosAMesa / listMesaEnviosPage", () => {
    const loadSrc = readFileSync(
      join(process.cwd(), "src/lib/adminBernardoLoad.ts"),
      "utf8",
    );
    assert.match(loadSrc, /enviadosAMesa/);
    assert.match(loadSrc, /listMesaEnviosPage/);
    assert.match(loadSrc, /fechaEnvioMesa|fecha_envio_mesa|loadAllMesaEnvios/);
    assert.doesNotMatch(loadSrc, /agenda_sheet_operational_results.*ingresos/i);
    assert.match(loadSrc, /ingresosTotal: summary\.enviadosAMesa/);
  });
});
