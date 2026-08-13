/**
 * P180 B1 — OperationalColor + effective_result + replay 11/12/13.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  backgroundToHex,
  classifyOperationalColor,
  isOperationalRedBackground,
  normalizeHexColor,
  type EffectiveBackground,
} from "./effective-background";
import {
  deriveBiometricEffectiveResult,
  deriveNotificationEffectiveResult,
  deriveSignatureEffectiveResult,
} from "./operational-effective-result";
import {
  buildOperationalResultUpsertRows,
  countCompletedOperational,
} from "./operational-results";

const GREEN_A = { red: 0x6a / 255, green: 0xa8 / 255, blue: 0x4f / 255 };
const GREEN_B = { red: 0x93 / 255, green: 0xc4 / 255, blue: 0x7d / 255 };
const RED = { red: 1, green: 0, blue: 0 };
const ORANGE = { red: 1, green: 0x99 / 255, blue: 0 };
const PINK = { red: 0xd5 / 255, green: 0xa6 / 255, blue: 0xbd / 255 };
const BLUE = { red: 0x4a / 255, green: 0x86 / 255, blue: 0xe8 / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };

function hexToBg(hex: string | null | undefined): EffectiveBackground {
  const n = normalizeHexColor(hex);
  if (!n) return null;
  return {
    red: parseInt(n.slice(1, 3), 16) / 255,
    green: parseInt(n.slice(3, 5), 16) / 255,
    blue: parseInt(n.slice(5, 7), 16) / 255,
  };
}

describe("P180 OperationalColor", () => {
  it("verdes auditados", () => {
    assert.equal(classifyOperationalColor(GREEN_A), "GREEN");
    assert.equal(classifyOperationalColor(GREEN_B), "GREEN");
    assert.equal(backgroundToHex(GREEN_A), "#6AA84F");
    assert.equal(backgroundToHex(GREEN_B), "#93C47D");
  });

  it("rojo / naranja / otros / unknown", () => {
    assert.equal(classifyOperationalColor(RED), "RED");
    assert.equal(isOperationalRedBackground(RED), true);
    assert.equal(classifyOperationalColor(ORANGE), "ORANGE");
    assert.equal(isOperationalRedBackground(ORANGE), false);
    assert.equal(classifyOperationalColor(PINK), "OTHER");
    assert.equal(classifyOperationalColor(BLUE), "OTHER");
    assert.equal(classifyOperationalColor(WHITE), "OTHER");
    assert.equal(classifyOperationalColor(null), "UNKNOWN");
    assert.equal(classifyOperationalColor("#6AA84F"), "GREEN");
  });
});

describe("P180 effective_result rules", () => {
  it("bio GREEN CESI current", () => {
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "GREEN",
        raw: "CESI MTY",
        notes: "",
      }),
      "COMPLETED_CURRENT",
    );
  });

  it("bio GREEN CESI historical", () => {
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "GREEN",
        raw: "CESI MTY",
        notes: "TENIA BIOMETRICOS",
        auxText: "10 agosto",
      }),
      "COMPLETED_HISTORICAL",
    );
  });

  it("bio RED CESI conflict", () => {
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "RED",
        raw: "CESI MTY",
        notes: "TENIA BIOMETRICOS",
      }),
      "MANUAL_REVIEW",
    );
  });

  it("bio ORANGE CESI conflict", () => {
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "ORANGE",
        raw: "CESI APODACA",
        notes: "",
      }),
      "MANUAL_REVIEW",
    );
  });

  it("bio RED X / falla sistema", () => {
    assert.equal(
      deriveBiometricEffectiveResult({ color: "RED", raw: "X", notes: "" }),
      "FAILED",
    );
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "RED",
        raw: "X",
        notes: "REAGENDA, FALLAS EN EL SISTEMA",
      }),
      "REBOOK_REQUIRED",
    );
  });

  it("bio GREEN solo inscripción → historical", () => {
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "GREEN",
        raw: "CESI MTY",
        notes: "TENIA BIOMETRICOS | ES SOLO INSCRIPCION, ASESORA AGENDO MAL",
      }),
      "COMPLETED_HISTORICAL",
    );
  });

  it("firma GREEN SI / YA CON BETTY", () => {
    assert.equal(
      deriveSignatureEffectiveResult({ color: "GREEN", raw: "SI" }),
      "COMPLETED_CURRENT",
    );
    assert.equal(
      deriveSignatureEffectiveResult({
        color: "GREEN",
        raw: "YA CON BETTY",
      }),
      "COMPLETED_CURRENT",
    );
    assert.equal(
      deriveSignatureEffectiveResult({
        color: "GREEN",
        raw: "YA CON BETTY 2",
      }),
      "COMPLETED_CURRENT",
    );
  });

  it("firma RED X / ORANGE ambiguous", () => {
    assert.equal(
      deriveSignatureEffectiveResult({ color: "RED", raw: "X" }),
      "FAILED",
    );
    assert.equal(
      deriveSignatureEffectiveResult({
        color: "ORANGE",
        raw: "SI",
      }),
      "MANUAL_REVIEW",
    );
  });

  it("notif GREEN BETTY / RED X", () => {
    assert.equal(
      deriveNotificationEffectiveResult({
        color: "GREEN",
        raw: "BETTY",
      }),
      "COMPLETED_CURRENT",
    );
    assert.equal(
      deriveNotificationEffectiveResult({
        color: "GREEN",
        raw: "YA CON BETTY",
      }),
      "COMPLETED_CURRENT",
    );
    assert.equal(
      deriveNotificationEffectiveResult({ color: "RED", raw: "X" }),
      "FAILED",
    );
  });

  it("template inscripción naranja vacío → PENDING", () => {
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "ORANGE",
        raw: "",
        notes: "",
      }),
      "PENDING",
    );
  });

  it("reagendados block → REBOOK_REQUIRED (no KPI)", () => {
    assert.equal(
      deriveBiometricEffectiveResult({
        color: "GREEN",
        raw: "CESI MTY",
        notes: "",
        inReagendadosBlock: true,
      }),
      "REBOOK_REQUIRED",
    );
  });
});

describe("P180 stale/duplicate counting", () => {
  it("STALE excluded; 2 CURRENT same booking → 0 (no winner)", () => {
    const org = "00000000-0000-4000-8000-000000000001";
    const booking = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const base = {
      organization_id: org,
      spreadsheet_id: "ss",
      sheet_id: 1,
      sheet_title: "13 AGOSTO",
      booking_date: "2026-08-13",
      kind: "biometricos" as const,
      location_id: "apodaca" as const,
      slot_time: "08:30",
      expediente_id: null,
      biometric_result_class: "COMPLETED" as const,
      biometric_result_raw: "CESI APODACA",
      notification_result_class: "PENDING" as const,
      notification_result_raw: null,
      signature_result_class: "PENDING" as const,
      signature_result_raw: null,
      notes_raw: null,
      biometric_cell_red: false,
      notification_cell_red: false,
      signature_cell_red: false,
      operational_red_veto: false,
      inscripcion_rebook_required: false,
      inscripcion_rebook_reason_raw: null,
      biometric_color: "GREEN" as const,
      notification_color: "UNKNOWN" as const,
      signature_color: "UNKNOWN" as const,
      biometric_effective_result: "COMPLETED_CURRENT" as const,
      notification_effective_result: "PENDING" as const,
      signature_effective_result: "PENDING" as const,
    };
    const rows = [
      {
        ...base,
        sheet_row: 39,
        booking_id: booking,
        projection_status: "CURRENT" as const,
      },
      {
        ...base,
        sheet_row: 47,
        booking_id: booking,
        projection_status: "STALE" as const,
      },
      {
        ...base,
        sheet_row: 38,
        booking_id: booking,
        projection_status: "CURRENT" as const,
      },
    ];
    assert.equal(
      countCompletedOperational({ rows, metric: "biometricos" }),
      0,
    );
  });
});

describe("P180 replay forense 11/12/13 (B0)", () => {
  const forensicCandidates = [
    "src/domain/agenda-sheets/fixtures/p180-b0-forensic.json",
    "/tmp/p180-forensic-sheet.json",
  ];
  let forensicPath = forensicCandidates[0]!;
  let forensic: {
    tabs: Array<{ title: string; rows: Array<Record<string, string | null>> }>;
  } | null = null;
  for (const cand of forensicCandidates) {
    try {
      forensic = JSON.parse(readFileSync(cand, "utf8"));
      forensicPath = cand;
      break;
    } catch { /* next */ }
  }

  function tabToGrid(tab: {
    rows: Array<Record<string, string | null>>;
  }) {
    const maxRow = Math.max(...tab.rows.map((r) => Number(r.row)));
    const grid: (string | null)[][] = [];
    const bg: EffectiveBackground[][] = [];
    for (let i = 0; i < maxRow; i++) {
      grid.push(Array(21).fill(""));
      bg.push([null, null, null, null, null]);
    }
    for (const r of tab.rows) {
      const i = Number(r.row) - 1;
      const row = grid[i]!;
      row[0] = r.A || "";
      row[1] = r.B_nss || "";
      row[2] = r.C_name || "";
      row[3] = r.D || "";
      row[4] = r.E || "";
      row[5] = r.F || "";
      row[6] = r.G || "";
      row[7] = r.notes || "";
      row[15] = r.P || "";
      row[16] = r.Q || "";
      bg[i] = [
        hexToBg(r.colorE),
        hexToBg(r.colorF),
        hexToBg(r.colorG),
        null,
        null,
      ];
    }
    for (let i = 0; i < grid.length; i++) {
      const a = String(grid[i]![0] || "").toUpperCase();
      const e = String(grid[i]![4] || "").toUpperCase();
      if (a === "HORA" && e === "BIOMETRICOS") grid[i]![7] = "NOTAS";
    }
    return { grid, bg };
  }

  function replay(title: string, date: string) {
    assert.ok(forensic, `fixture local ${forensicPath} requerida`);
    const tab = forensic!.tabs.find((t) => t.title === title);
    assert.ok(tab, title);
    const { grid, bg } = tabToGrid(tab!);
    return buildOperationalResultUpsertRows({
      organizationId: "00000000-0000-4000-8000-000000000001",
      spreadsheetId: "1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA",
      sheetId: 1,
      sheetTitle: title,
      bookingDate: date,
      grid,
      backgroundsEi: bg,
    });
  }

  it("11 AGOSTO counts exactos", () => {
    assert.ok(forensic, `fixture requerida (${forensicPath})`);
    const rows = replay("11 AGOSTO", "2026-08-11");
    assert.equal(countCompletedOperational({ rows, metric: "biometricos" }), 7);
    assert.equal(countCompletedOperational({ rows, metric: "firmas" }), 15);
    assert.equal(
      countCompletedOperational({ rows, metric: "notificaciones" }),
      7,
    );
  });

  it("12 AGOSTO counts exactos", () => {
    assert.ok(forensic, `fixture requerida (${forensicPath})`);
    const rows = replay("12 AGOSTO", "2026-08-12");
    assert.equal(countCompletedOperational({ rows, metric: "biometricos" }), 0);
    assert.equal(countCompletedOperational({ rows, metric: "firmas" }), 8);
    assert.equal(
      countCompletedOperational({ rows, metric: "notificaciones" }),
      0,
    );
  });

  it("13 AGOSTO counts + filas KPI", () => {
    assert.ok(forensic, `fixture requerida (${forensicPath})`);
    const rows = replay("13 AGOSTO", "2026-08-13");
    assert.equal(countCompletedOperational({ rows, metric: "biometricos" }), 5);
    assert.equal(countCompletedOperational({ rows, metric: "firmas" }), 6);
    assert.equal(
      countCompletedOperational({ rows, metric: "notificaciones" }),
      5,
    );

    const bioCurrent = rows
      .filter(
        (r) =>
          r.kind === "biometricos" &&
          r.biometric_effective_result === "COMPLETED_CURRENT",
      )
      .map((r) => r.sheet_row)
      .sort((a, b) => a - b);
    assert.deepEqual(bioCurrent, [24, 25, 29, 31, 32]);

    const firmCurrent = rows
      .filter(
        (r) =>
          r.kind === "firmas" &&
          r.signature_effective_result === "COMPLETED_CURRENT",
      )
      .map((r) => r.sheet_row)
      .sort((a, b) => a - b);
    assert.deepEqual(firmCurrent, [7, 8, 9, 10, 11, 13]);

    const r17 = rows.find((r) => r.sheet_row === 17);
    assert.equal(r17?.biometric_effective_result, "MANUAL_REVIEW");
    const r39 = rows.find((r) => r.sheet_row === 39);
    assert.equal(r39?.biometric_color, "ORANGE");
    assert.notEqual(r39?.biometric_effective_result, "COMPLETED_CURRENT");
    const r18 = rows.find((r) => r.sheet_row === 18);
    assert.equal(r18?.biometric_effective_result, "COMPLETED_HISTORICAL");
    const r22 = rows.find((r) => r.sheet_row === 22);
    assert.ok(
      r22?.biometric_effective_result === "MANUAL_REVIEW" ||
        r22?.biometric_effective_result === "REBOOK_REQUIRED",
      `r22=${r22?.biometric_effective_result}`,
    );
    assert.notEqual(r22?.biometric_effective_result, "COMPLETED_CURRENT");
    const r34 = rows.find((r) => r.sheet_row === 34);
    assert.ok(
      r34?.biometric_effective_result === "MANUAL_REVIEW" ||
        r34?.biometric_effective_result === "REBOOK_REQUIRED",
      `r34=${r34?.biometric_effective_result}`,
    );
    assert.notEqual(r34?.biometric_effective_result, "COMPLETED_CURRENT");
  });
});

describe("P180 domain↔Edge parity (effective modules)", () => {
  it("mirrors existen y exportan classifyOperationalColor / derive*", () => {
    const edgeBg = readFileSync(
      "supabase/functions/_shared/agenda-sheets/effective-background.ts",
      "utf8",
    );
    const edgeEff = readFileSync(
      "supabase/functions/_shared/agenda-sheets/operational-effective-result.ts",
      "utf8",
    );
    assert.match(edgeBg, /classifyOperationalColor/);
    assert.match(edgeBg, /OperationalColor/);
    assert.match(edgeEff, /deriveBiometricEffectiveResult/);
    assert.match(edgeEff, /COMPLETED_CURRENT/);
    const reconcile = readFileSync(
      "supabase/functions/agenda-sheet-reconcile/index.ts",
      "utf8",
    );
    assert.match(reconcile, /agenda_sheet_ops_mark_stale_except/);
    assert.match(reconcile, /decideOpsMarkStale/);
  });
});
