import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelClearBatchRanges,
  classifyCancelRowClearance,
  inventoryStatusFromSheetRow,
  preserveGNUnchanged,
  snapshotPreserveGN,
  verifyClearedRowReadback,
} from "./cancel-row-clearance";

function rowAU(partial: Record<number, string>): string[] {
  const r = Array(21).fill("");
  for (const [k, v] of Object.entries(partial)) r[Number(k)] = v;
  return r;
}

describe("cancel-row-clearance", () => {
  const booking = "8b53fffc-3e06-452c-b03d-9d17a0d721eb";

  it("safe_to_clear: batchClear solo B:D y O:U (nunca A)", () => {
    const r = rowAU({
      0: "10:00 AM",
      1: "32997618353",
      2: "JOSE OSVALDO",
      3: "Laura",
      14: "CANCELADA",
      15: booking,
      16: "exp-1",
      18: "crm",
      20: "2",
    });
    const d = classifyCancelRowClearance({
      row: r,
      cancelledBookingId: booking,
      cancelledExpedienteId: "exp-1",
    });
    assert.equal(d.classification, "safe_to_clear");
    assert.equal(d.keepHora, "10:00 AM");
    assert.equal(d.clearBtoD, true);
    assert.equal(d.clearOU, true);
    assert.equal(d.clearEtoF, false);
    const ranges = cancelClearBatchRanges("03 AGOSTO ", 34);
    assert.deepEqual(ranges, [
      "'03 AGOSTO '!B34:D34",
      "'03 AGOSTO '!O34:U34",
    ]);
    assert.ok(!ranges.some((x) => /!A/.test(x)));
    assert.ok(!ranges.some((x) => /G|H|I|J|K|L|M|N/.test(x.split("!")[1] ?? "")));
  });

  it("José live X/X → manual_result_conflict terminal", () => {
    const r = rowAU({
      0: "10:00 AM",
      1: "32997618353",
      2: "JOSE OSVALDO LIMON HERNANDEZ",
      3: "LAURA VENEGAS",
      4: "X",
      5: "X",
      6: "*",
      7: "COMPROBANTE ACTUALIZADO",
      14: "CANCELADA",
      15: booking,
      16: "5bcdb717-127c-4852-86a5-699dab10ee07",
      18: "crm",
      19: "2026-07-30T17:38:02.442Z",
      20: "2",
    });
    const d = classifyCancelRowClearance({
      row: r,
      cancelledBookingId: booking,
    });
    assert.equal(d.classification, "manual_result_conflict");
    assert.equal(d.terminalNoRetry, true);
    assert.deepEqual(d.conflictingColumns, ["E", "F"]);
    assert.equal(d.clearBtoD, false);
    assert.equal(d.clearOU, false);
  });

  it("already_absent si B:D y O:U vacíos", () => {
    const d = classifyCancelRowClearance({
      row: rowAU({ 0: "10:00 AM" }),
      cancelledBookingId: booking,
    });
    assert.equal(d.classification, "already_absent");
  });

  it("already_absent sin P aunque haya NSS (no limpia por NSS)", () => {
    const d = classifyCancelRowClearance({
      row: rowAU({ 0: "10:00", 1: "32997618353", 2: "X" }),
      cancelledBookingId: booking,
    });
    assert.equal(d.classification, "already_absent");
  });

  it("row_reused si P es otro booking (impide limpieza)", () => {
    const d = classifyCancelRowClearance({
      row: rowAU({
        0: "10:00",
        1: "32997618353",
        15: "d4c91a59-bc10-41e1-a329-5c5d43a6f935",
        18: "crm",
      }),
      cancelledBookingId: booking,
    });
    assert.equal(d.classification, "row_reused");
    assert.equal(d.clearBtoD, false);
  });

  it("U stale vs link no bloquea clear si P coincide (CANCELADA legado)", () => {
    const d = classifyCancelRowClearance({
      row: rowAU({
        0: "10:00",
        1: "32997618353",
        14: "CANCELADA",
        15: booking,
        18: "crm",
        20: "2",
      }),
      cancelledBookingId: booking,
    });
    assert.equal(d.classification, "safe_to_clear");
  });

  it("manual_result_conflict si E o F tienen texto", () => {
    const d = classifyCancelRowClearance({
      row: rowAU({
        0: "10:00",
        15: booking,
        18: "crm",
        4: "BIO OK",
      }),
      cancelledBookingId: booking,
    });
    assert.equal(d.classification, "manual_result_conflict");
    assert.equal(d.terminalNoRetry, true);
    assert.deepEqual(d.conflictingColumns, ["E"]);
  });

  it("not_crm_owned si source≠crm", () => {
    const d = classifyCancelRowClearance({
      row: rowAU({ 0: "10:00", 15: booking, 18: "sheets" }),
      cancelledBookingId: booking,
    });
    assert.equal(d.classification, "not_crm_owned");
    assert.equal(d.terminalNoRetry, true);
  });

  it("read-back: A exacto, G:N intactos, B:D/O:U vacíos", () => {
    const before = rowAU({
      0: "10:00 AM",
      6: "*",
      7: "NOTE",
    });
    const after = rowAU({
      0: "10:00 AM",
      6: "*",
      7: "NOTE",
    });
    const ok = verifyClearedRowReadback({
      row: after,
      expectedHora: "10:00 AM",
      expectedGN: before,
    });
    assert.equal(ok.ok, true);
    assert.ok(preserveGNUnchanged(before, after));
    const badHora = verifyClearedRowReadback({
      row: rowAU({ 0: "11:00 AM", 6: "*" }),
      expectedHora: "10:00 AM",
      expectedGN: before,
    });
    assert.equal(badHora.ok, false);
    assert.equal(badHora.reason, "hora_mismatch");
    const badGn = verifyClearedRowReadback({
      row: rowAU({ 0: "10:00 AM", 6: "CHANGED" }),
      expectedHora: "10:00 AM",
      expectedGN: before,
    });
    assert.equal(badGn.ok, false);
    assert.equal(badGn.reason, "gn_changed");
    const badBd = verifyClearedRowReadback({
      row: rowAU({ 0: "10:00 AM", 1: "x", 6: "*", 7: "NOTE" }),
      expectedHora: "10:00 AM",
      expectedGN: before,
    });
    assert.equal(badBd.ok, false);
  });

  it("snapshot G:N valor por valor", () => {
    const r = rowAU({ 6: "a", 13: "z" });
    assert.deepEqual(snapshotPreserveGN(r), [
      "a",
      "",
      "",
      "",
      "",
      "",
      "",
      "z",
    ]);
  });

  it("inventario: CANCELADA → available (incluso con conflicto E/F)", () => {
    assert.equal(
      inventoryStatusFromSheetRow({
        nss: "1",
        name: "X",
        techBookingId: booking,
        techEstado: "CANCELADA",
      }),
      "available",
    );
    assert.equal(
      inventoryStatusFromSheetRow({
        nss: "",
        name: "",
        techBookingId: booking,
        techEstado: "SINCRONIZADO",
      }),
      "linked",
    );
  });

  it("inventario: REAGENDADO → disabled (no occupied_external)", () => {
    assert.equal(
      inventoryStatusFromSheetRow({
        nss: "NSS1",
        name: "CLIENTE",
        advisor: "ASESOR",
        techBookingId: booking,
        techEstado: "REAGENDADO",
      }),
      "disabled",
    );
  });
});
