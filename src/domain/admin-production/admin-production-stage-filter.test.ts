import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminAsesorProductionRow } from "./repo";
import {
  adminProductionSelectedStageCount,
  filterAdminProductionRowsByPaso,
  shortPasoVisualAdminFilterNombre,
} from "./admin-production-stage-filter";

function row(
  partial: Partial<AdminAsesorProductionRow> & { asesorId: string },
): AdminAsesorProductionRow {
  return {
    asesorId: partial.asesorId,
    asesorNombre: partial.asesorNombre ?? partial.asesorId,
    asesorEmail: partial.asesorEmail ?? null,
    enviadosAMesa: partial.enviadosAMesa ?? 0,
    precalificacionesAprobadas: partial.precalificacionesAprobadas ?? 0,
    precalificacionesNoCumple: partial.precalificacionesNoCumple ?? 0,
    aprobadasMayorA20000: partial.aprobadasMayorA20000 ?? 0,
    montoAprobadoTotal: partial.montoAprobadoTotal ?? 0,
    etapas: partial.etapas ?? {},
  };
}

describe("Admin producción filtro por etapa P* (row.etapas)", () => {
  it("P1 todas: filas intactas", () => {
    const rows = [
      row({ asesorId: "a", enviadosAMesa: 2, etapas: { "5": 1 } }),
      row({ asesorId: "b", enviadosAMesa: 1, etapas: {} }),
    ];
    assert.deepEqual(filterAdminProductionRowsByPaso(rows, "todas"), rows);
  });

  it("P2 etapa visual 4 (= interna 5): solo count > 0", () => {
    const rows = [
      row({ asesorId: "a", enviadosAMesa: 3, etapas: { "5": 2, "6": 1 } }),
      row({ asesorId: "b", enviadosAMesa: 9, etapas: { "6": 4 } }),
      row({ asesorId: "c", enviadosAMesa: 1, etapas: { "5": 1 } }),
    ];
    // paso visual 4 → interna [5]
    const filtered = filterAdminProductionRowsByPaso(rows, "4");
    assert.deepEqual(
      filtered.map((r) => r.asesorId),
      ["a", "c"],
    );
    assert.equal(adminProductionSelectedStageCount(rows[0]!, [5]), 2);
  });

  it("P3 paso visual multi-etapa (paso 3 → internas 3+4)", () => {
    const r = row({
      asesorId: "a",
      etapas: { "3": 2, "4": 3, "5": 9 },
    });
    assert.equal(adminProductionSelectedStageCount(r, [3, 4]), 5);
    const filtered = filterAdminProductionRowsByPaso(
      [r, row({ asesorId: "b", etapas: { "5": 1 } })],
      "3",
    );
    assert.deepEqual(
      filtered.map((x) => x.asesorId),
      ["a"],
    );
  });

  it("P4/P5 vacío y nombre corto", () => {
    assert.equal(
      filterAdminProductionRowsByPaso(
        [row({ asesorId: "a", etapas: { "6": 1 } })],
        "4", // Admin paso 4 → interna 5; no match
      ).length,
      0,
    );
    assert.equal(shortPasoVisualAdminFilterNombre("todas"), null);
    assert.ok(shortPasoVisualAdminFilterNombre("5"));
  });

  it("A8 Listo firma (paso Admin 8) suma etapas 9+10", () => {
    const rows = [
      row({ asesorId: "a", enviadosAMesa: 5, etapas: { "9": 2, "10": 1 } }),
      row({ asesorId: "b", enviadosAMesa: 3, etapas: { "11": 3 } }),
      row({ asesorId: "c", enviadosAMesa: 1, etapas: { "10": 1 } }),
    ];
    const filtered = filterAdminProductionRowsByPaso(rows, "8");
    assert.deepEqual(
      filtered.map((r) => r.asesorId),
      ["a", "c"],
    );
    assert.equal(adminProductionSelectedStageCount(rows[0]!, [9, 10]), 3);
  });
});
