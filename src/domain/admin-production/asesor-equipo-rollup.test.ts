import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandAdminAsesorFilterIds,
  matchesAdminAsesorEquipoFilter,
  reportingAdminAsesorId,
  type AdminEquipoRollup,
} from "./asesor-equipo-rollup";

const SILVIA = "67d7eb87-2e00-48ec-91bc-1d2c98118b11";
const JULIETA = "798cc7a4-08e1-4210-abbf-806e654391aa";
const ALONSO = "2ce56fce-3cf9-4c3b-b420-31aa5a625871";
const SOLO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const EQUIPOS: AdminEquipoRollup[] = [
  {
    leaderId: SILVIA,
    memberIds: [JULIETA, ALONSO],
  },
];

describe("admin asesor equipo rollup", () => {
  it("expand líder → líder + miembros", () => {
    const ids = expandAdminAsesorFilterIds(SILVIA, EQUIPOS);
    assert.ok(ids);
    assert.equal(ids!.length, 3);
    assert.ok(ids!.includes(SILVIA));
    assert.ok(ids!.includes(JULIETA));
    assert.ok(ids!.includes(ALONSO));
  });

  it("expand miembro → solo él (no expande a todo el equipo)", () => {
    assert.deepEqual(expandAdminAsesorFilterIds(JULIETA, EQUIPOS), [JULIETA]);
  });

  it("expand null/vacío → null (sin filtro)", () => {
    assert.equal(expandAdminAsesorFilterIds(null, EQUIPOS), null);
    assert.equal(expandAdminAsesorFilterIds("", EQUIPOS), null);
  });

  it("reporting: miembro → líder; líder → self", () => {
    assert.equal(reportingAdminAsesorId(JULIETA, EQUIPOS), SILVIA);
    assert.equal(reportingAdminAsesorId(ALONSO, EQUIPOS), SILVIA);
    assert.equal(reportingAdminAsesorId(SILVIA, EQUIPOS), SILVIA);
    assert.equal(reportingAdminAsesorId(SOLO, EQUIPOS), SOLO);
  });

  it("filtro Silvia matchea expedientes del equipo", () => {
    assert.equal(
      matchesAdminAsesorEquipoFilter(JULIETA, SILVIA, EQUIPOS),
      true,
    );
    assert.equal(
      matchesAdminAsesorEquipoFilter(SILVIA, SILVIA, EQUIPOS),
      true,
    );
    assert.equal(
      matchesAdminAsesorEquipoFilter(SOLO, SILVIA, EQUIPOS),
      false,
    );
  });
});
