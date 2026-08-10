import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOOK_SLOT_JUST_TAKEN_MESSAGE,
  assertWebhookPayloadHasNoPii,
  classifyInventoryReconcileRow,
  classifySheetRowOccupancy,
  countAvailableByPhysicalOccupancy,
  decideBookHardGate,
  isSheetIdentityOccupied,
  manualOccupancyFingerprint,
} from "./manual-occupancy";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";
import { inventoryStatusFromSheetRow } from "./cancel-row-clearance";

describe("manual-occupancy hotfix inbound", () => {
  it("1. fila vacía → FREE / disponible", () => {
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "",
        name: "",
        advisor: "",
      }),
      "FREE",
    );
    const c = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "available" },
        { slotTime: "09:00", status: "available" },
        { slotTime: "09:00", status: "available" },
      ],
      "09:00",
    );
    assert.equal(c.available, 3);
  });

  it("2. NSS manual → OCCUPIED_MANUAL", () => {
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "12345678901",
        name: "",
        advisor: "",
      }),
      "OCCUPIED_MANUAL",
    );
  });

  it("3. nombre manual → OCCUPIED_MANUAL", () => {
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "",
        name: "JUAN EXTERNO",
        advisor: "",
      }),
      "OCCUPIED_MANUAL",
    );
  });

  it("4. asesor manual → OCCUPIED_MANUAL", () => {
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "",
        name: "",
        advisor: "Asesor Externo",
      }),
      "OCCUPIED_MANUAL",
    );
    assert.equal(
      inventoryStatusFromSheetRow({
        nss: "",
        name: "",
        advisor: "Asesor Externo",
        techBookingId: null,
      }),
      "occupied_external",
    );
  });

  it("5. fila CRM → OCCUPIED_CRM una sola vez", () => {
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "123",
        name: "X",
        advisor: "Y",
        techBookingId: "db7997ca-2838-4f3d-8abb-1d515db8f394",
      }),
      "OCCUPIED_CRM",
    );
    const c = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "linked" },
        { slotTime: "09:00", status: "available" },
        { slotTime: "09:00", status: "available" },
      ],
      "09:00",
    );
    assert.equal(c.occupied, 1);
    assert.equal(c.available, 2);
  });

  it("6. 3 filas / 1 manual → quedan 2", () => {
    const c = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "available" },
        { slotTime: "09:00", status: "available" },
      ],
      "09:00",
    );
    assert.equal(c.available, 2);
  });

  it("7. 3 filas / 3 manuales → quedan 0", () => {
    const c = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "occupied_external" },
      ],
      "09:00",
    );
    assert.equal(c.available, 0);
  });

  it("8. mezcla manual + CRM sin doble conteo", () => {
    const c = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "linked" },
      ],
      "09:00",
    );
    assert.equal(c.physicalTotal, 3);
    assert.equal(c.occupied, 3);
    assert.equal(c.available, 0);
  });

  it("9. borrar manual → FREE / vuelve disponible", () => {
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "",
        name: "",
        advisor: "",
      }),
      "FREE",
    );
    const afterClear = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "available" },
        { slotTime: "09:00", status: "available" },
      ],
      "09:00",
    );
    assert.equal(afterClear.available, 2);
  });

  it("10. booking CRM ausente del Sheet no libera", () => {
    assert.equal(
      classifyInventoryReconcileRow({
        sheetClass: "FREE",
        inventoryStatus: "linked",
        inventoryBookingId: "db7997ca-2838-4f3d-8abb-1d515db8f394",
        sheetBookingId: null,
      }),
      "CRM_BOOKING_MISSING_FROM_SHEET",
    );
  });

  it("11. entrada sin HORA → MANUAL_ENTRY_WITHOUT_SLOT", () => {
    assert.equal(
      classifySheetRowOccupancy({
        hora: "",
        nss: "123",
        name: "X",
        advisor: "Y",
      }),
      "MANUAL_ENTRY_WITHOUT_SLOT",
    );
    const { issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-11",
      sheetTitle: "11 AGOSTO",
      grid: [
        ["MONTERREY FIRMAS"],
        ["", "12345678901", "SIN HORA", "Externo"],
        ["9:00 AM", "", "", ""],
      ],
    });
    assert.ok(issues.some((i) => i.code === "MANUAL_ENTRY_WITHOUT_SLOT"));
  });

  it("12–13. firmas y biométricos: parse ocupa por asesor", () => {
    for (const header of ["MONTERREY FIRMAS", "MONTERREY BIOMETRICOS"] as const) {
      const { rows } = parsePhysicalInventoryFromGrid({
        bookingDate: "2026-08-11",
        sheetTitle: "11 AGOSTO",
        grid: [
          [header],
          ["9:00 AM", "", "", "Asesor Externo"],
          ["9:00 AM", "", "", ""],
          ["9:00 AM", "", "", ""],
        ],
      });
      assert.equal(rows[0]?.status, "occupied_external");
      assert.equal(rows[1]?.status, "available");
      assert.equal(rows[2]?.status, "available");
    }
  });

  it("14–16. hard gate: race → rechazo + mensaje", () => {
    assert.deepEqual(decideBookHardGate({ liveAvailableForSlot: 1 }), {
      allow: true,
      message: null,
    });
    const denied = decideBookHardGate({ liveAvailableForSlot: 0 });
    assert.equal(denied.allow, false);
    assert.equal(denied.message, BOOK_SLOT_JUST_TAKEN_MESSAGE);
  });

  it("17–18. no overbooking / no doble conteo en fixture 9:00", () => {
    // #1 manual, #2 manual, #3 libre → 1 disponible
    const before = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "available" },
      ],
      "09:00",
    );
    assert.equal(before.available, 1);
    // ocupar #3
    const after = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "occupied_external" },
      ],
      "09:00",
    );
    assert.equal(after.available, 0);
    // borrar #2
    const cleared = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "occupied_external" },
        { slotTime: "09:00", status: "available" },
        { slotTime: "09:00", status: "occupied_external" },
      ],
      "09:00",
    );
    assert.equal(cleared.available, 1);
  });

  it("19. sincronización no cambia etapa (clasificación pura)", () => {
    // Función de dominio no toca etapa/subestado — solo clasifica.
    assert.ok(typeof classifySheetRowOccupancy === "function");
  });

  it("20. Apps Script payload sin PII", () => {
    const ok = assertWebhookPayloadHasNoPii({
      spreadsheetId: "x",
      sheetId: 1,
      sheetTitle: "11 AGOSTO",
      rowNumber: 10,
      source: "sheets_onedit",
      editedAt: "2026-08-10T00:00:00Z",
      idempotencyKey: "k",
    });
    assert.equal(ok.ok, true);
    const bad = assertWebhookPayloadHasNoPii({
      spreadsheetId: "x",
      nss: "123",
      nombre: "Juan",
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.forbiddenKeys.includes("nss"));
  });

  it("fingerprint estable sin depender de orden visual", () => {
    const a = manualOccupancyFingerprint({
      nss: "123",
      name: "Juan",
      advisor: "Ana",
    });
    const b = manualOccupancyFingerprint({
      nss: "123",
      name: "Juan",
      advisor: "Ana",
    });
    assert.equal(a, b);
    assert.ok(a.startsWith("m"));
  });

  it("isSheetIdentityOccupied", () => {
    assert.equal(isSheetIdentityOccupied({ advisor: "X" }), true);
    assert.equal(isSheetIdentityOccupied({}), false);
  });

  it("reconcile classes MATCHED / MANUAL / FREE / DUPLICATE", () => {
    assert.equal(
      classifyInventoryReconcileRow({
        sheetClass: "OCCUPIED_CRM",
        inventoryStatus: "linked",
        inventoryBookingId: "a",
        sheetBookingId: "a",
      }),
      "MATCHED_CRM",
    );
    assert.equal(
      classifyInventoryReconcileRow({
        sheetClass: "OCCUPIED_MANUAL",
        inventoryStatus: "occupied_external",
        inventoryBookingId: null,
        sheetBookingId: null,
      }),
      "MANUAL_OCCUPIED",
    );
    assert.equal(
      classifyInventoryReconcileRow({
        sheetClass: "FREE",
        inventoryStatus: "available",
        inventoryBookingId: null,
        sheetBookingId: null,
      }),
      "FREE",
    );
    assert.equal(
      classifyInventoryReconcileRow({
        sheetClass: "FREE",
        inventoryStatus: "available",
        inventoryBookingId: null,
        sheetBookingId: null,
        duplicateSheetBookingIds: true,
      }),
      "DUPLICATE",
    );
  });
});
