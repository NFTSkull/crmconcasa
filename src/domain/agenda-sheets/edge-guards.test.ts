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
});
