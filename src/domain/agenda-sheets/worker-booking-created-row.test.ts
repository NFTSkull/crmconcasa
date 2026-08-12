import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Selección de fila preasignada para booking_created CRM→Sheets.
 * Espejo de la lógica del worker (payload claim primero; sin buscar available).
 */
function resolvePreassignedSheetRow(input: {
  payloadSheetRow?: number | null;
  payloadSheetTitle?: string | null;
  payloadInventoryId?: string | null;
  inventoryById?: {
    id: string;
    sheet_row: number;
    sheet_title: string;
    sheet_id: number;
    status: string;
  } | null;
  inventoryByBooking?: Array<{
    sheet_row: number;
    sheet_title: string;
    sheet_id: number;
    status: string;
  }>;
}): { sheetRow: number; sheetTitle: string; sheetId: number } | null {
  const targetRow = Number(input.payloadSheetRow ?? 0);
  const tabTitle = String(input.payloadSheetTitle ?? "");

  if (Number.isFinite(targetRow) && targetRow > 0 && tabTitle) {
    const tabSheetId =
      input.payloadInventoryId && input.inventoryById
        ? Number(input.inventoryById.sheet_id ?? 0)
        : 0;
    return { sheetRow: targetRow, sheetTitle: tabTitle, sheetId: tabSheetId };
  }

  const fromId = input.inventoryById;
  if (fromId && ["claimed", "linked"].includes(fromId.status)) {
    return {
      sheetRow: fromId.sheet_row,
      sheetTitle: fromId.sheet_title,
      sheetId: fromId.sheet_id,
    };
  }

  const hit = (input.inventoryByBooking ?? []).find((r) =>
    ["claimed", "linked"].includes(r.status)
  );
  if (hit) {
    return {
      sheetRow: hit.sheet_row,
      sheetTitle: hit.sheet_title,
      sheetId: hit.sheet_id,
    };
  }
  return null;
}

describe("worker booking_created preassigned row (Nallely-equivalent)", () => {
  const nallelyInv = {
    id: "acc6b9a2-e565-4a73-8075-9fc612b96796",
    sheet_row: 9,
    sheet_title: "18 AGOSTO",
    sheet_id: 1285227407,
    status: "claimed",
  };

  it("usa payload sheet_row=9 claimed (no busca fila 10/11 available)", () => {
    const resolved = resolvePreassignedSheetRow({
      payloadSheetRow: 9,
      payloadSheetTitle: "18 AGOSTO",
      payloadInventoryId: nallelyInv.id,
      inventoryById: nallelyInv,
      inventoryByBooking: [
        nallelyInv,
        { ...nallelyInv, sheet_row: 10, status: "available", id: "x10" },
        { ...nallelyInv, sheet_row: 11, status: "available", id: "x11" },
      ],
    });
    assert.deepEqual(resolved, {
      sheetRow: 9,
      sheetTitle: "18 AGOSTO",
      sheetId: 1285227407,
    });
  });

  it("si faltan coords payload, toma claimed|linked por booking", () => {
    const resolved = resolvePreassignedSheetRow({
      payloadSheetRow: 0,
      payloadSheetTitle: "",
      inventoryByBooking: [
        { sheet_row: 10, sheet_title: "18 AGOSTO", sheet_id: 1, status: "available" },
        {
          sheet_row: 9,
          sheet_title: "18 AGOSTO",
          sheet_id: 1285227407,
          status: "claimed",
        },
      ],
    });
    assert.equal(resolved?.sheetRow, 9);
  });

  it("sin preasignación → null (no inventa available)", () => {
    const resolved = resolvePreassignedSheetRow({
      inventoryByBooking: [
        { sheet_row: 10, sheet_title: "18 AGOSTO", sheet_id: 1, status: "available" },
      ],
    });
    assert.equal(resolved, null);
  });
});

describe("outbox backlog drain simulation", () => {
  it("20 pending con claim limit 10 requieren 2 pases", () => {
    const CLAIM_LIMIT = 10;
    let pending = 20;
    let passes = 0;
    while (pending > 0) {
      const claimed = Math.min(CLAIM_LIMIT, pending);
      pending -= claimed;
      passes += 1;
      assert.ok(claimed <= CLAIM_LIMIT);
    }
    assert.equal(passes, 2);
    assert.equal(pending, 0);
  });
});
