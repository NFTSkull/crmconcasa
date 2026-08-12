import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { agendaSheetOpsFingerprint } from "./operational-apply-fingerprint";
import {
  biometricTargetEtapa,
  resolveSheetRejectMotivo,
  SHEET_REJECT_FALLBACK_MOTIVO,
  signatureTargetEtapa,
} from "./operational-apply-policy";

describe("operational-apply-fingerprint", () => {
  const base = {
    spreadsheetId: "ssid",
    sheetId: 170001,
    sheetRow: 10,
    expedienteId: "00000000-0000-4000-9170-000000000101",
    bookingId: "00000000-0000-4000-9170-000000000201",
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
  };

  it("es determinista", () => {
    const a = agendaSheetOpsFingerprint(base);
    const b = agendaSheetOpsFingerprint({ ...base });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{32}$/);
  });

  it("cambia con notes_raw / classes", () => {
    const a = agendaSheetOpsFingerprint(base);
    const b = agendaSheetOpsFingerprint({ ...base, notesRaw: "SE RETIRO" });
    const c = agendaSheetOpsFingerprint({
      ...base,
      notificationResultClass: "COMPLETED",
      notificationResultRaw: "YA CON BETTY",
    });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it("color-only fingerprint A!=B", () => {
    const a = agendaSheetOpsFingerprint(base);
    const b = agendaSheetOpsFingerprint({
      ...base,
      biometricCellRed: true,
      operationalRedVeto: true,
    });
    assert.notEqual(a, b);
  });

  it("normaliza kind lower y class upper; ignora whitespace", () => {
    const a = agendaSheetOpsFingerprint(base);
    const b = agendaSheetOpsFingerprint({
      ...base,
      kind: "  BIOMETRICOS ",
      biometricResultClass: " completed ",
      biometricResultRaw: "  CESI MTY  ",
    });
    assert.equal(a, b);
  });

  it("coincide con el algoritmo SQL (concat_ws U+001F + md5)", () => {
    const parts = [
      "ssid",
      "170001",
      "10",
      "00000000-0000-4000-9170-000000000101",
      "00000000-0000-4000-9170-000000000201",
      "biometricos",
      "COMPLETED",
      "CESI MTY",
      "PENDING",
      "",
      "PENDING",
      "",
      "",
      "0",
      "0",
      "0",
      "0",
    ];
    const expected = createHash("md5")
      .update(parts.join("\u001f"), "utf8")
      .digest("hex");
    assert.equal(agendaSheetOpsFingerprint(base), expected);
  });
});

describe("operational-apply-policy", () => {
  it("motivo: notes → raw → fallback", () => {
    assert.equal(
      resolveSheetRejectMotivo({
        kind: "biometricos",
        biometricClass: "FAILED_OR_NOT_ATTENDED",
        biometricRaw: "X",
        notificationClass: "PENDING",
        notificationRaw: null,
        signatureClass: "PENDING",
        signatureRaw: null,
        notesRaw: "SE RETIRO",
      }),
      "SE RETIRO",
    );
    assert.equal(
      resolveSheetRejectMotivo({
        kind: "biometricos",
        biometricClass: "FAILED_OR_NOT_ATTENDED",
        biometricRaw: "NO ASISTIO",
        notificationClass: "PENDING",
        notificationRaw: null,
        signatureClass: "PENDING",
        signatureRaw: null,
        notesRaw: "  ",
      }),
      "NO ASISTIO",
    );
    assert.equal(
      resolveSheetRejectMotivo({
        kind: "firmas",
        biometricClass: "PENDING",
        biometricRaw: null,
        notificationClass: "PENDING",
        notificationRaw: null,
        signatureClass: "FAILED_OR_NOT_ATTENDED",
        signatureRaw: null,
        notesRaw: null,
      }),
      SHEET_REJECT_FALLBACK_MOTIVO,
    );
  });

  it("targets bio 5 / 8 y firma 11", () => {
    assert.equal(
      biometricTargetEtapa({
        biometricClass: "COMPLETED",
        notificationClass: "PENDING",
      }),
      5,
    );
    assert.equal(
      biometricTargetEtapa({
        biometricClass: "COMPLETED",
        notificationClass: "COMPLETED",
      }),
      8,
    );
    assert.equal(
      biometricTargetEtapa({
        biometricClass: "FAILED_OR_NOT_ATTENDED",
        notificationClass: "PENDING",
      }),
      null,
    );
    assert.equal(signatureTargetEtapa("COMPLETED"), 11);
    assert.equal(signatureTargetEtapa("PENDING"), null);
  });
});
