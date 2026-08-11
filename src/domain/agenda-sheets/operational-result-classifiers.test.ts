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

describe("operational-result-classifiers — firmas (FIRMO/FIRMA)", () => {
  it("1. SI + BETTY → completed", () => {
    assert.equal(classifySignatureResult("SI", "BETTY"), "COMPLETED");
    assert.equal(formatSignatureResultRaw("SI", "BETTY"), "SI / BETTY");
  });

  it("2. X + X → not completed", () => {
    assert.equal(
      classifySignatureResult("X", "X"),
      "FAILED_OR_NOT_ATTENDED",
    );
  });

  it("3. vacío → pending", () => {
    assert.equal(classifySignatureResult(""), "PENDING");
    assert.equal(classifySignatureResult(null, null), "PENDING");
  });

  it("4. YA CON BETTY + vacío → no completed", () => {
    assert.equal(classifySignatureResult("YA CON BETTY", ""), "PENDING");
    assert.notEqual(
      classifySignatureResult("YA CON BETTY", ""),
      "COMPLETED",
    );
  });

  it("5. COMPLETO + YA CON BETTY → no completed (nota no manda)", () => {
    // La nota COMPLETO no se pasa al clasificador; solo FIRMO/FIRMA.
    assert.equal(classifySignatureResult("YA CON BETTY", ""), "PENDING");
    assert.notEqual(classifySignatureResult("COMPLETO ✔"), "COMPLETED");
  });

  it("6. COMPLETO + vacío FIRMO → no completed", () => {
    assert.equal(classifySignatureResult("", ""), "PENDING");
    assert.notEqual(classifySignatureResult("COMPLETO ✔", ""), "COMPLETED");
  });

  it("7. FALTA ACUSE no define firma por sí solo", () => {
    assert.equal(classifySignatureResult("YA CON BETTY", ""), "PENDING");
    // Sin FIRMO=SI no hay COMPLETED aunque la nota diga FALTA ACUSE.
    assert.notEqual(classifySignatureResult("FALTA ACUSE"), "COMPLETED");
  });

  it("8. SI + nota cualquiera sigue regla canónica (FIRMA manda)", () => {
    assert.equal(classifySignatureResult("SI", "BETTY"), "COMPLETED");
    assert.equal(classifySignatureResult("SI", "CESI MTY"), "COMPLETED");
    // SI sin FIRMA → no inventar completado.
    assert.equal(classifySignatureResult("SI", ""), "PENDING");
  });

  it("X / NO ASISTIO excluido", () => {
    assert.equal(
      classifySignatureResult("X", "X"),
      "FAILED_OR_NOT_ATTENDED",
    );
    assert.equal(
      classifySignatureResult("X", "NO ASISTIO"),
      "FAILED_OR_NOT_ATTENDED",
    );
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
    ["9:00", "3", "E", "F", "BETTY", "YA CON BETTY", "", "03 agosto", "COMPLETO ✔"],
    ["9:30", "4", "G", "H", "BETTY", "SI", "BETTY", "04 agosto", "COMPLETO ✔"],
  ];

  it("bio/notif intactos; firmas usan FIRMO no COMPLETO", () => {
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
    // Solo la fila SI/BETTY cuenta; YA CON BETTY + COMPLETO no.
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
  });

  it("17. realtime delta SI→X → Firmas -1", () => {
    const org = "00000000-0000-4000-8000-000000000001";
    const mk = (grid: string[][]) =>
      buildOperationalResultUpsertRows({
        organizationId: org,
        spreadsheetId: "ss",
        sheetId: 1,
        sheetTitle: "10 AGOSTO",
        bookingDate: "2026-08-10",
        grid,
      });
    const up = mk(baseGrid);
    assert.equal(countCompletedOperational({ rows: up, metric: "firmas" }), 1);

    const gridDown = baseGrid.map((r) => [...r]);
    gridDown[7] = [
      "9:30",
      "4",
      "G",
      "H",
      "BETTY",
      "X",
      "X",
      "04 agosto",
      "NO ASISTIO",
    ];
    const down = mk(gridDown);
    assert.equal(
      countCompletedOperational({ rows: down, metric: "firmas" }),
      0,
    );
  });

  it("18. realtime delta pending→SI → Firmas +1", () => {
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
    const pending = mk(baseGrid);
    // base tiene 1 SI; subir la fila YA CON BETTY → SI/BETTY
    assert.equal(
      countCompletedOperational({ rows: pending, metric: "firmas" }),
      1,
    );
    const gridUp = baseGrid.map((r) => [...r]);
    gridUp[6] = [
      "9:00",
      "3",
      "E",
      "F",
      "BETTY",
      "SI",
      "BETTY",
      "03 agosto",
      "COMPLETO ✔",
    ];
    const up = mk(gridUp);
    assert.equal(countCompletedOperational({ rows: up, metric: "firmas" }), 2);
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

  it("9. fixture 11 agosto → Firmas COMPLETED = 0 (YA CON BETTY + COMPLETO no cuentan)", () => {
    const firmoFirmaPairs: Array<[string, string, string]> = [
      ["YA CON BETTY", "", "COMPLETO ✔"],
      ["YA CON BETTY", "", ""],
      ["YA CON BETTY", "", "COMPLETO ✔"],
      ["YA CON BETTY", "", "FALTA ACUSE"],
      ["YA CON BETTY", "", "COMPLETO ✔"],
      ["YA CON BETTY", "", ""],
      ["YA CON BETTY", "", "COMPLETO ✔"],
      ["", "", ""],
    ];
    const completed = firmoFirmaPairs.filter(
      ([firmo, firma]) =>
        classifySignatureResult(firmo, firma) === "COMPLETED",
    ).length;
    assert.equal(completed, 0);

    const grid = [
      ["MONTERREY FIRMAS"],
      ["HORA", "", "", "", "NOTIFICACION", "FIRMO", "FIRMA", "NOTAS", ""],
      ...firmoFirmaPairs.map(([firmo, firma, note], i) => [
        "9:00",
        String(i),
        "C",
        "A",
        "BETTY",
        firmo,
        firma,
        "03 agosto",
        note,
      ]),
    ];
    const rows = buildOperationalResultUpsertRows({
      organizationId: "00000000-0000-4000-8000-000000000001",
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "11 AGOSTO",
      bookingDate: "2026-08-11",
      grid,
    });
    const firmasTotal = countCompletedOperational({
      rows,
      metric: "firmas",
    });
    const firmasDetail = rows.filter(
      (r) => r.kind === "firmas" && r.signature_result_class === "COMPLETED",
    );
    assert.equal(firmasTotal, 0);
    assert.equal(firmasDetail.length, firmasTotal); // KPI == detail
  });

  it("10–11. fixture 10 agosto → SI contados; X/NO ASISTIO excluido", () => {
    const pairs: Array<[string, string]> = [
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["SI", "BETTY"],
      ["X", "X"],
      ["SI", "BETTY"],
    ];
    const completed = pairs.filter(
      ([firmo, firma]) =>
        classifySignatureResult(firmo, firma) === "COMPLETED",
    ).length;
    assert.equal(completed, 11);
    assert.equal(classifySignatureResult("X", "X"), "FAILED_OR_NOT_ATTENDED");

    const grid = [
      ["MONTERREY FIRMAS"],
      ["HORA", "", "", "", "NOTIFICACION", "FIRMO", "FIRMA"],
      ...pairs.map(([firmo, firma], i) => [
        "9:00",
        String(i),
        "C",
        "A",
        "BETTY",
        firmo,
        firma,
        "",
        firmo === "X" ? "NO ASISTIO" : "",
      ]),
    ];
    const rows = buildOperationalResultUpsertRows({
      organizationId: "00000000-0000-4000-8000-000000000001",
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "10 AGOSTO",
      bookingDate: "2026-08-10",
      grid,
    });
    const firmasTotal = countCompletedOperational({
      rows,
      metric: "firmas",
    });
    const firmasDetail = rows.filter(
      (r) => r.kind === "firmas" && r.signature_result_class === "COMPLETED",
    );
    assert.equal(firmasTotal, 11);
    assert.equal(firmasDetail.length, firmasTotal); // 12. KPI == detail
  });

  it("13. Bernardo load no usa booked / get_mesa_agenda_bookings para ops", () => {
    const loadSrc = readFileSync(
      join(process.cwd(), "src/lib/adminBernardoLoad.ts"),
      "utf8",
    );
    assert.match(loadSrc, /bernardo_ops_detail/);
    assert.doesNotMatch(loadSrc, /get_mesa_agenda_bookings/);
    assert.doesNotMatch(loadSrc, /bookedOnly/);
    assert.doesNotMatch(loadSrc, /fetchMesaAgendaBookings/);
  });

  it("14–16. Biométricos / Notificaciones / Ingresos sin cambio de fuente", () => {
    const loadSrc = readFileSync(
      join(process.cwd(), "src/lib/adminBernardoLoad.ts"),
      "utf8",
    );
    assert.match(loadSrc, /enviadosAMesa/);
    assert.match(loadSrc, /listMesaEnviosPage/);
    assert.match(loadSrc, /ingresosTotal: summary\.enviadosAMesa/);
    assert.match(loadSrc, /metric: "biometricos"/);
    assert.match(loadSrc, /metric: "notificaciones"/);

    // Snapshot bio/notif del clasificador (intactos).
    assert.equal(classifyBiometricResult("CESI MTY"), "COMPLETED");
    assert.equal(classifyNotificationResult("BETTY 8"), "COMPLETED");
    assert.equal(classifyNotificationResult("YA CON BETTY"), "COMPLETED");
  });

  it("UI Firmas: subtítulo completadas; no citas agendadas", () => {
    const dash = readFileSync(
      join(process.cwd(), "src/components/admin/AdminBernardoDashboard.tsx"),
      "utf8",
    );
    assert.match(dash, /Firmas completadas en el periodo/);
    assert.doesNotMatch(dash, /Citas de firma en el periodo/);
  });
});
