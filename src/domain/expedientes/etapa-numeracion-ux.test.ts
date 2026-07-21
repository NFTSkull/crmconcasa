import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatEtapaAsesorCorrespondenciaMesa,
  formatEtapaAsesorPasoLabel,
  formatEtapaMesaBandejaBadge,
  formatEtapaMesaCorrespondenciaAsesor,
  formatEtapaMesaLabel,
  getCorrespondenciaNumeracionEtapa,
  NOTA_NUMERACION_ETAPAS,
} from "./etapa-numeracion-ux";

test("getCorrespondenciaNumeracionEtapa: etapas 1–3 coinciden con paso visual", () => {
  for (const n of [1, 2, 3] as const) {
    const c = getCorrespondenciaNumeracionEtapa(n);
    assert.equal(c.etapaInterna, n);
    assert.equal(c.pasoVisual, n);
    assert.equal(c.numeracionDifiere, false);
  }
});

test("getCorrespondenciaNumeracionEtapa: etapa 5 → paso 4 (caso índice B0)", () => {
  const c = getCorrespondenciaNumeracionEtapa(5);
  assert.equal(c.etapaInterna, 5);
  assert.equal(c.pasoVisual, 4);
  assert.equal(c.numeracionDifiere, true);
  assert.match(c.nombreMesa, /Biometr/i);
  assert.equal(formatEtapaMesaLabel(5), "Etapa 5 — Biometría (resultado)");
  assert.equal(
    formatEtapaAsesorPasoLabel(5),
    "Paso 4 de 11 — Biometría (resultado)",
  );
  assert.equal(
    formatEtapaMesaCorrespondenciaAsesor(5),
    "En vista asesor: paso 4 de 11",
  );
  assert.match(formatEtapaAsesorCorrespondenciaMesa(5), /Etapa interna 5/);
});

test("etapa legacy 4 se muestra como paso 3 en asesor", () => {
  const c = getCorrespondenciaNumeracionEtapa(4);
  assert.equal(c.etapaInterna, 4);
  assert.equal(c.pasoVisual, 3);
  assert.equal(c.numeracionDifiere, true);
  assert.ok(formatEtapaMesaCorrespondenciaAsesor(4));
});

test("bandeja Mesa incluye hint solo cuando difiere", () => {
  const same = formatEtapaMesaBandejaBadge(2);
  assert.equal(same.hintAsesor, null);
  assert.match(same.principal, /^Etapa 2:/);

  const diff = formatEtapaMesaBandejaBadge(5);
  assert.equal(diff.hintAsesor, "paso 4/11 asesor");
  assert.match(diff.principal, /^Etapa 5:/);
});

test("nota de numeración documenta la conversión", () => {
  assert.match(NOTA_NUMERACION_ETAPAS, /legacy 4/);
  assert.match(NOTA_NUMERACION_ETAPAS, /etapa_actual/);
});
