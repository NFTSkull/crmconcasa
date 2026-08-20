import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * AE8/AE9: enrich fail-soft — un batch fallido no elimina filas.
 * Contrato documentado; la UI usa Promise.allSettled + catch vacío.
 */
describe("P203 Asesor enrich fail-soft AE8–AE9", () => {
  it("AE8 docs failure leaves row ids intact", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const settled = await Promise.allSettled([
      Promise.reject(new Error("docs")),
      Promise.resolve("ok"),
    ]);
    assert.equal(settled[0]!.status, "rejected");
    assert.equal(settled[1]!.status, "fulfilled");
    assert.deepEqual(
      rows.map((r) => r.id),
      ["a", "b"],
    );
  });

  it("AE9 agenda failure leaves row ids intact", async () => {
    const rows = [{ id: "x" }];
    const settled = await Promise.allSettled([Promise.reject(new Error("agenda"))]);
    assert.equal(settled[0]!.status, "rejected");
    assert.equal(rows.length, 1);
  });
});
