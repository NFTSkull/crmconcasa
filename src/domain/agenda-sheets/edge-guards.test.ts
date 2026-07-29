/**
 * Pruebas unitarias del adaptador memoria / mensajes de conflicto (Edge-like).
 * No llama a Google ni Supabase reales.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSheetNss,
  parseSheetTabDate,
  parseSheetTime,
} from "./parsers";
import {
  assertTechColumnsWritable,
  isPreserveOnlyColumn1Based,
  isTechColumn1Based,
} from "./tech-columns";

describe("agenda-sheets edge-like guards", () => {
  it("rechaza spreadsheet tab inválida antes de RPC", () => {
    assert.equal(parseSheetTabDate("NO DATE", 2026).ok, false);
  });
  it("NSS canónico conserva ceros", () => {
    const n = normalizeSheetNss("'03179461821");
    assert.equal(n.ok, true);
    if (n.ok) assert.equal(n.value, "03179461821");
  });
  it("hora canónica HH:mm", () => {
    const t = parseSheetTime("8:30AM");
    assert.equal(t.ok, true);
    if (t.ok) assert.equal(t.value, "08:30");
  });
  it("update técnico O:U: mismo booking idempotente; otro booking conflicto", () => {
    const same = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "b1", "e", "k", "sheets", "t", "1"],
      bookingId: "b1",
    });
    assert.equal(same.ok, true);
    if (same.ok) assert.equal(same.mode, "idempotent");
    const other = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "b2", "e", "k", "sheets", "t", "1"],
      bookingId: "b1",
    });
    assert.equal(other.ok, false);
  });
  it("Apps Script ignora O:U (cols 15-21) y preserva H:N (8-14)", () => {
    assert.equal(isTechColumn1Based(15), true);
    assert.equal(isTechColumn1Based(16), true); // P booking
    assert.equal(isPreserveOnlyColumn1Based(8), true);
    assert.equal(isPreserveOnlyColumn1Based(9), true);
  });
});
