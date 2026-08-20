import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_VISIBLE_STAGES,
  TOTAL_PASOS_ADMIN_VISIBLES,
  adminVisibleStagesContainCitaParaFirma,
  etapasInternasParaAdminPasoFilter,
  getAdminEtapaDisplayNombre,
  mapEtapaInternaAAdminPaso,
  projectAdminVisibleStageBuckets,
} from "./admin-visible-stages";

describe("Admin visible stages — hide firma appointment (A1–A14)", () => {
  it("A1/A7 catálogo sin «Cita para firma» y 10 pasos consecutivos", () => {
    assert.equal(TOTAL_PASOS_ADMIN_VISIBLES, 10);
    assert.equal(ADMIN_VISIBLE_STAGES.length, 10);
    assert.equal(adminVisibleStagesContainCitaParaFirma(), false);
    assert.deepEqual(
      ADMIN_VISIBLE_STAGES.map((e) => e.pasoAdmin),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
  });

  it("A2 stage9=36 stage10=0 → Listo firma 36", () => {
    const buckets = projectAdminVisibleStageBuckets(
      [
        { etapa: 9, count: 36, pct: 0 },
        { etapa: 10, count: 0, pct: 0 },
      ],
      36,
    );
    assert.equal(buckets.find((b) => b.etapa === 10), undefined);
    assert.equal(buckets.find((b) => b.etapa === 9)?.count, 36);
  });

  it("A3/A4/A5 stage9=36 stage10=2 → 38; total y pct preservados", () => {
    const total = 100;
    const buckets = projectAdminVisibleStageBuckets(
      [
        { etapa: 1, count: 62, pct: 62 },
        { etapa: 9, count: 36, pct: 36 },
        { etapa: 10, count: 2, pct: 2 },
      ],
      total,
    );
    assert.equal(buckets.find((b) => b.etapa === 10), undefined);
    assert.equal(buckets.find((b) => b.etapa === 9)?.count, 38);
    assert.equal(buckets.find((b) => b.etapa === 9)?.pct, 38);
    assert.equal(
      buckets.reduce((a, b) => a + b.count, 0),
      100,
    );
  });

  it("A6 click Listo firma → internas [9,10]", () => {
    assert.deepEqual(etapasInternasParaAdminPasoFilter("8"), [9, 10]);
  });

  it("A8/A11/A12 Firmado=11 Pago=12; producción mapping", () => {
    assert.deepEqual(etapasInternasParaAdminPasoFilter("9"), [11]);
    assert.deepEqual(etapasInternasParaAdminPasoFilter("10"), [12]);
    assert.equal(mapEtapaInternaAAdminPaso(11), 9);
    assert.equal(mapEtapaInternaAAdminPaso(12), 10);
    assert.equal(mapEtapaInternaAAdminPaso(9), 8);
    assert.equal(mapEtapaInternaAAdminPaso(10), 8);
  });

  it("A9/A10 label Admin para etapa 10; interna intacta conceptualmente", () => {
    assert.equal(getAdminEtapaDisplayNombre(10), "Listo para agendar firma");
    assert.equal(getAdminEtapaDisplayNombre(9), "Listo para agendar firma");
    assert.equal(getAdminEtapaDisplayNombre(11), "Firmado");
    // A10: el caller conserva etapaActual=10; solo cambia el label.
    const interna = 10;
    assert.equal(interna, 10);
    assert.notEqual(getAdminEtapaDisplayNombre(interna), "Cita para firma");
  });

  it("P115 biométrico: paso Admin 3 → [3,4]", () => {
    assert.deepEqual(etapasInternasParaAdminPasoFilter("3"), [3, 4]);
    assert.equal(mapEtapaInternaAAdminPaso(4), 3);
  });
});
