import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildOperationalResultFromRow,
  buildOperationalResultUpsertRows,
  classifyOperationalRow,
} from "./operational-results";
import {
  extractOperationalNote,
  findNotasColumnIndex,
} from "./operational-notes";
import { classifyBiometricResult } from "./operational-result-classifiers";
import { agendaSheetOpsFingerprint } from "./operational-apply-fingerprint";
import {
  buildAgendaSheetApplyRpcArgs,
  localNoApplyUnlinked,
  parseApplyRpcResponse,
  shouldSkipApplyRpc,
} from "./operational-apply-rpc";

const ORG = "00000000-0000-4000-9170-000000000001";
const BOOK = "00000000-0000-4000-9170-000000000201";
const EXP = "00000000-0000-4000-9170-000000000101";

function padRow(cells: Record<number, string>): string[] {
  const row: string[] = Array.from({ length: 21 }, () => "");
  for (const [k, v] of Object.entries(cells)) {
    row[Number(k)] = v;
  }
  return row;
}

describe("operational-notes", () => {
  it("1. bio notes desde H (fallback)", () => {
    const row = padRow({ 4: "CESI MTY", 5: "X", 7: "SE RETIRO" });
    assert.equal(
      extractOperationalNote({ kind: "biometricos", row }),
      "SE RETIRO",
    );
  });

  it("2. firmas notes H o I según layout", () => {
    const h = padRow({ 5: "X", 7: "NO ASISTIO" });
    assert.equal(extractOperationalNote({ kind: "firmas", row: h }), "NO ASISTIO");
    const iOnly = padRow({ 5: "X", 8: "NO CUMPLE" });
    assert.equal(
      extractOperationalNote({ kind: "firmas", row: iOnly }),
      "NO CUMPLE",
    );
  });

  it("header NOTAS gana sobre índice", () => {
    const header = [
      "HORA",
      "NSS",
      "NOMBRE",
      "ASESOR",
      "BIOMETRICOS",
      "NOTIFICACION",
      "",
      "OTRO",
      "NOTAS",
    ];
    assert.equal(findNotasColumnIndex(header), 8);
    const row = padRow({ 7: "IGNORAR", 8: "BURO DE CREDITO" });
    assert.equal(
      extractOperationalNote({ kind: "biometricos", row, headerRow: header }),
      "BURO DE CREDITO",
    );
  });

  it("3. notes no altera classifier", () => {
    const row = padRow({ 4: "CESI MTY", 5: "", 7: "NO ASISTIO" });
    const c = classifyOperationalRow({ kind: "biometricos", row });
    assert.equal(c.biometric_result_class, "COMPLETED");
    assert.equal(classifyBiometricResult("CESI MTY"), "COMPLETED");
    assert.notEqual(c.biometric_result_class, "FAILED_OR_NOT_ATTENDED");
  });
});

describe("operational-results notes_raw", () => {
  it("4. upsert rows incluyen notes_raw", () => {
    const rows = buildOperationalResultUpsertRows({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "12 AGOSTO",
      bookingDate: "2026-08-12",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        [
          "HORA",
          "NSS",
          "NOMBRE",
          "ASESOR",
          "BIOMETRICOS",
          "NOTIFICACION",
          "",
          "NOTAS",
        ],
        [
          "08:30",
          "1",
          "A",
          "B",
          "CESI MTY",
          "X",
          "",
          "SE RETIRO",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          BOOK,
          EXP,
        ],
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.notes_raw, "SE RETIRO");
    assert.equal(rows[0]?.biometric_result_class, "COMPLETED");
    assert.equal(rows[0]?.notification_result_class, "FAILED_OR_NOT_ATTENDED");
  });
});

describe("operational-apply-rpc", () => {
  const baseRow = {
    organization_id: ORG,
    spreadsheet_id: "ssid",
    sheet_id: 170001,
    sheet_title: "t",
    booking_date: "2026-08-12",
    sheet_row: 10,
    kind: "biometricos" as const,
    location_id: "monterrey" as const,
    slot_time: "08:30",
    booking_id: BOOK,
    expediente_id: EXP,
    biometric_result_class: "COMPLETED" as const,
    biometric_result_raw: "CESI MTY",
    notification_result_class: "PENDING" as const,
    notification_result_raw: null,
    signature_result_class: "PENDING" as const,
    signature_result_raw: null,
    notes_raw: null as string | null,
    biometric_cell_red: false,
    notification_cell_red: false,
    signature_cell_red: false,
    operational_red_veto: false,
    inscripcion_rebook_required: false,
    inscripcion_rebook_reason_raw: null as string | null,
    biometric_color: "GREEN" as const,
    notification_color: "UNKNOWN" as const,
    signature_color: "UNKNOWN" as const,
    biometric_effective_result: "COMPLETED_CURRENT" as const,
    notification_effective_result: "PENDING" as const,
    signature_effective_result: "PENDING" as const,
    projection_status: "CURRENT" as const,
  };

  it("5. helper mapea todos los args RPC", () => {
    const args = buildAgendaSheetApplyRpcArgs(baseRow);
    assert.equal(args.p_organization_id, ORG);
    assert.equal(args.p_booking_id, BOOK);
    assert.equal(args.p_expediente_id, EXP);
    assert.equal(args.p_kind, "biometricos");
    assert.equal(args.p_biometric_result_class, "COMPLETED");
    assert.equal(args.p_notes_raw, null);
    assert.match(args.p_fingerprint, /^[0-9a-f]{32}$/);
  });

  it("6. P/Q null → skip seguro", () => {
    assert.equal(
      shouldSkipApplyRpc({ booking_id: null, expediente_id: EXP }),
      true,
    );
    const local = localNoApplyUnlinked({
      ...baseRow,
      booking_id: null,
    });
    assert.equal(local.outcome, "NO_APPLY");
    assert.equal(local.skippedRpc, true);
  });

  it("7–10. outcomes business vs unexpected", () => {
    assert.equal(
      parseApplyRpcResponse({
        data: { ok: true, outcome: "NO_OP" },
        error: null,
      }).outcome,
      "NO_OP",
    );
    assert.equal(
      parseApplyRpcResponse({
        data: { ok: true, outcome: "APPLIED", mutated: true },
        error: null,
      }).mutated,
      true,
    );
    assert.equal(
      parseApplyRpcResponse({
        data: { ok: true, outcome: "LINK_MISMATCH" },
        error: null,
      }).unexpected,
      false,
    );
    assert.equal(
      parseApplyRpcResponse({
        data: { ok: true, outcome: "REQUIRES_HUMAN_REACTIVATION" },
        error: null,
      }).outcome,
      "REQUIRES_HUMAN_REACTIVATION",
    );
    const err = parseApplyRpcResponse({
      data: null,
      error: { message: "boom" },
    });
    assert.equal(err.unexpected, true);
    assert.equal(err.outcome, "RPC_ERROR");
  });
});

describe("fingerprint TS == algoritmo SQL (casos P170 B2)", () => {
  function sqlLikeMd5(parts: string[]): string {
    return createHash("md5").update(parts.join("\u001f"), "utf8").digest("hex");
  }

  const cases = [
    {
      name: "1 bio CESI + pending",
      input: {
        spreadsheetId: "ssid",
        sheetId: 1,
        sheetRow: 2,
        expedienteId: EXP,
        bookingId: BOOK,
        kind: "biometricos",
        biometricResultClass: "COMPLETED",
        biometricResultRaw: "CESI MTY",
        notificationResultClass: "PENDING",
        notificationResultRaw: null as string | null,
        signatureResultClass: "PENDING",
        signatureResultRaw: null as string | null,
        notesRaw: null as string | null,
        biometricCellRed: false,
        notificationCellRed: false,
        signatureCellRed: false,
        operationalRedVeto: false,
      },
    },
    {
      name: "2 CESI + YA CON BETTY",
      input: {
        spreadsheetId: "ssid",
        sheetId: 1,
        sheetRow: 2,
        expedienteId: EXP,
        bookingId: BOOK,
        kind: "biometricos",
        biometricResultClass: "COMPLETED",
        biometricResultRaw: "CESI MTY",
        notificationResultClass: "COMPLETED",
        notificationResultRaw: "YA CON BETTY",
        signatureResultClass: "PENDING",
        signatureResultRaw: null as string | null,
        notesRaw: null as string | null,
        biometricCellRed: false,
        notificationCellRed: false,
        signatureCellRed: false,
        operationalRedVeto: false,
      },
    },
    {
      name: "3 CESI + X + SE RETIRO",
      input: {
        spreadsheetId: "ssid",
        sheetId: 1,
        sheetRow: 2,
        expedienteId: EXP,
        bookingId: BOOK,
        kind: "biometricos",
        biometricResultClass: "COMPLETED",
        biometricResultRaw: "CESI MTY",
        notificationResultClass: "FAILED_OR_NOT_ATTENDED",
        notificationResultRaw: "X",
        signatureResultClass: "PENDING",
        signatureResultRaw: null as string | null,
        notesRaw: "SE RETIRO",
        biometricCellRed: false,
        notificationCellRed: false,
        signatureCellRed: false,
        operationalRedVeto: false,
      },
    },
    {
      name: "4 FIRMO SI",
      input: {
        spreadsheetId: "ssid",
        sheetId: 1,
        sheetRow: 2,
        expedienteId: EXP,
        bookingId: BOOK,
        kind: "firmas",
        biometricResultClass: "PENDING",
        biometricResultRaw: null as string | null,
        notificationResultClass: "PENDING",
        notificationResultRaw: null as string | null,
        signatureResultClass: "COMPLETED",
        signatureResultRaw: "SI",
        notesRaw: null as string | null,
        biometricCellRed: false,
        notificationCellRed: false,
        signatureCellRed: false,
        operationalRedVeto: false,
      },
    },
    {
      name: "5 FIRMO X + NO ASISTIO",
      input: {
        spreadsheetId: "ssid",
        sheetId: 1,
        sheetRow: 2,
        expedienteId: EXP,
        bookingId: BOOK,
        kind: "firmas",
        biometricResultClass: "PENDING",
        biometricResultRaw: null as string | null,
        notificationResultClass: "PENDING",
        notificationResultRaw: null as string | null,
        signatureResultClass: "FAILED_OR_NOT_ATTENDED",
        signatureResultRaw: "X",
        notesRaw: "NO ASISTIO",
        biometricCellRed: false,
        notificationCellRed: false,
        signatureCellRed: false,
        operationalRedVeto: false,
      },
    },
  ] as const;

  for (const c of cases) {
    it(c.name, () => {
      const ts = agendaSheetOpsFingerprint(c.input);
      const parts = [
        c.input.spreadsheetId,
        String(c.input.sheetId),
        String(c.input.sheetRow),
        c.input.expedienteId,
        c.input.bookingId,
        c.input.kind,
        c.input.biometricResultClass,
        c.input.biometricResultRaw ?? "",
        c.input.notificationResultClass,
        c.input.notificationResultRaw ?? "",
        c.input.signatureResultClass,
        c.input.signatureResultRaw ?? "",
        c.input.notesRaw ?? "",
        c.input.biometricCellRed ? "1" : "0",
        c.input.notificationCellRed ? "1" : "0",
        c.input.signatureCellRed ? "1" : "0",
        c.input.operationalRedVeto ? "1" : "0",
      ];
      assert.equal(ts, sqlLikeMd5(parts));
    });
  }
});

describe("P170 B2 edge contract — webhook + reconcile", () => {
  const webhook = readFileSync(
    new URL(
      "../../../supabase/functions/agenda-sheet-webhook/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const reconcile = readFileSync(
    new URL(
      "../../../supabase/functions/agenda-sheet-reconcile/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const applyHelper = readFileSync(
    new URL(
      "../../../supabase/functions/_shared/agenda-sheets/apply-operational-result.ts",
      import.meta.url,
    ),
    "utf8",
  );

  it("A/B/C webhook: projection + apply antes de already_synced", () => {
    assert.match(webhook, /upsertAndApplyOperationalResultRow/);
    assert.match(webhook, /applyOperationalResult|evaluateOperationalApplyGate/);
    assert.match(webhook, /already_synced/);
    const applyIdx = webhook.indexOf("upsertAndApplyOperationalResultRow");
    const syncedIdx = webhook.indexOf('reason: "already_synced"');
    assert.ok(applyIdx > 0 && syncedIdx > applyIdx);
    assert.match(webhook, /operational_apply/);
  });

  it("D/E business outcome no es 500; F unexpected observable", () => {
    assert.match(applyHelper, /LINK_MISMATCH/);
    assert.match(applyHelper, /REQUIRES_HUMAN_REACTIVATION/);
    assert.match(applyHelper, /unexpected/);
    assert.match(webhook, /apply\.unexpected|operationalApply\.unexpected/);
  });

  it("reconcile: upsert chunk → apply por fila + resumen", () => {
    assert.match(reconcile, /agenda_sheet_ops_upsert_batch/);
    assert.match(reconcile, /applyOperationalResult/);
    assert.match(reconcile, /apply_count/);
    assert.match(reconcile, /apply_errors/);
    assert.match(reconcile, /apply_outcomes/);
    // Orden operativo: batch upsert luego apply por fila del chunk
    const opsBlock = reconcile.slice(
      reconcile.indexOf("Bernardo: proyección"),
    );
    const upsertIdx = opsBlock.indexOf("agenda_sheet_ops_upsert_batch");
    const applyIdx = opsBlock.indexOf("await applyOperationalResult");
    assert.ok(upsertIdx >= 0 && applyIdx > upsertIdx);
  });

  it("no segundo motor de etapa en Edge apply helper", () => {
    assert.doesNotMatch(applyHelper, /reactivar_expediente_rechazado/);
    assert.doesNotMatch(applyHelper, /UPDATE\s+expedientes/i);
    assert.doesNotMatch(applyHelper, /etapa_actual\s*=\s*\d/);
  });
});

describe("live flows conceptuales (builders)", () => {
  it("9. green→X cambia fingerprint / notes", () => {
    const green = buildOperationalResultFromRow({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "t",
      bookingDate: "2026-08-12",
      sheetRow: 5,
      kind: "biometricos",
      locationId: "monterrey",
      row: padRow({
        0: "08:30",
        4: "CESI MTY",
        5: "YA CON BETTY",
        15: BOOK,
        16: EXP,
      }),
    });
    const red = buildOperationalResultFromRow({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "t",
      bookingDate: "2026-08-12",
      sheetRow: 5,
      kind: "biometricos",
      locationId: "monterrey",
      row: padRow({
        0: "08:30",
        4: "CESI MTY",
        5: "X",
        7: "NO CUMPLE",
        15: BOOK,
        16: EXP,
      }),
    });
    assert.ok(green && red);
    assert.equal(green.notification_result_class, "COMPLETED");
    assert.equal(red.notification_result_class, "FAILED_OR_NOT_ATTENDED");
    assert.equal(red.notes_raw, "NO CUMPLE");
    assert.notEqual(
      agendaSheetOpsFingerprint({
        spreadsheetId: green.spreadsheet_id,
        sheetId: green.sheet_id,
        sheetRow: green.sheet_row,
        expedienteId: green.expediente_id,
        bookingId: green.booking_id,
        kind: green.kind,
        biometricResultClass: green.biometric_result_class,
        biometricResultRaw: green.biometric_result_raw,
        notificationResultClass: green.notification_result_class,
        notificationResultRaw: green.notification_result_raw,
        signatureResultClass: green.signature_result_class,
        signatureResultRaw: green.signature_result_raw,
        notesRaw: green.notes_raw,
        biometricCellRed: green.biometric_cell_red,
        notificationCellRed: green.notification_cell_red,
        signatureCellRed: green.signature_cell_red,
        operationalRedVeto: green.operational_red_veto,
      }),
      agendaSheetOpsFingerprint({
        spreadsheetId: red.spreadsheet_id,
        sheetId: red.sheet_id,
        sheetRow: red.sheet_row,
        expedienteId: red.expediente_id,
        bookingId: red.booking_id,
        kind: red.kind,
        biometricResultClass: red.biometric_result_class,
        biometricResultRaw: red.biometric_result_raw,
        notificationResultClass: red.notification_result_class,
        notificationResultRaw: red.notification_result_raw,
        signatureResultClass: red.signature_result_class,
        signatureResultRaw: red.signature_result_raw,
        notesRaw: red.notes_raw,
        biometricCellRed: red.biometric_cell_red,
        notificationCellRed: red.notification_cell_red,
        signatureCellRed: red.signature_cell_red,
        operationalRedVeto: red.operational_red_veto,
      }),
    );
  });

  it("10. firma SI COMPLETED; 11. unlinked NO_APPLY skip", () => {
    const sig = buildOperationalResultFromRow({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "t",
      bookingDate: "2026-08-12",
      sheetRow: 9,
      kind: "firmas",
      locationId: "monterrey",
      row: padRow({ 0: "09:00", 5: "SI", 15: BOOK, 16: EXP }),
    });
    assert.equal(sig?.signature_result_class, "COMPLETED");
    const unlinked = buildOperationalResultFromRow({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "t",
      bookingDate: "2026-08-12",
      sheetRow: 11,
      kind: "biometricos",
      locationId: "apodaca",
      row: padRow({ 0: "10:00", 4: "CESI APODACA" }),
    });
    assert.ok(unlinked);
    assert.equal(shouldSkipApplyRpc(unlinked), true);
  });

  it("reconcile grid mix: projection todas; skip unlinked", () => {
    const rows = buildOperationalResultUpsertRows({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 2,
      sheetTitle: "mix",
      bookingDate: "2026-08-12",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ["HORA", "NSS", "NOMBRE", "ASESOR", "BIOMETRICOS", "NOTIFICACION", "", "NOTAS"],
        ["08:00", "1", "a", "b", "CESI MTY", "", "", "", "", "", "", "", "", "", "", BOOK, EXP],
        ["08:30", "2", "a", "b", "CESI MTY", "YA CON BETTY", "", "", "", "", "", "", "", "", "", BOOK, EXP],
        ["09:00", "3", "manual", "x", "CESI MTY", "", "", "solo bernardo"],
        ["MONTERREY FIRMAS"],
        ["HORA", "NSS", "NOMBRE", "ASESOR", "NOTIFICACION", "FIRMO", "FIRMA", "NOTAS"],
        ["10:00", "4", "a", "b", "", "SI", "", "", "", "", "", "", "", "", "", BOOK, EXP],
        ["10:30", "5", "a", "b", "", "X", "", "NO ASISTIO", "", "", "", "", "", "", "", BOOK, EXP],
      ],
    });
    assert.ok(rows.length >= 5);
    const linked = rows.filter((r) => r.booking_id && r.expediente_id);
    const unlinked = rows.filter((r) => !r.booking_id || !r.expediente_id);
    assert.ok(linked.length >= 4);
    assert.ok(unlinked.length >= 1);
    assert.ok(unlinked.every((r) => shouldSkipApplyRpc(r)));
  });
});
