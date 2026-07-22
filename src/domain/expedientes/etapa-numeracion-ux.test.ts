import assert from "node:assert/strict";
import { test } from "node:test";
import {
  etapasInternasParaFiltroPaso,
  formatEtapaAsesorCorrespondenciaMesa,
  formatEtapaAsesorPasoLabel,
  formatEtapaMesaBandejaBadge,
  formatEtapaMesaCorrespondenciaAsesor,
  formatEtapaMesaLabel,
  formatPasoOperativoDestinoLabel,
  formatPasoOperativoLabel,
  getCorrespondenciaNumeracionEtapa,
  NOTA_NUMERACION_ETAPAS,
  opcionesFiltroPasoOperativo,
  opcionesMovimientoManualPaso,
} from "./etapa-numeracion-ux";
import {
  etapasInternasParaPasoVisual,
  mapEtapaInternaAPasoVisual,
} from "./asesor-seguimiento-operativo";

test("getCorrespondenciaNumeracionEtapa: etapas 1–3 coinciden con paso visual", () => {
  for (const n of [1, 2, 3] as const) {
    const c = getCorrespondenciaNumeracionEtapa(n);
    assert.equal(c.etapaInterna, n);
    assert.equal(c.pasoVisual, n);
    assert.equal(c.numeracionDifiere, false);
  }
});

test("P105: Mesa y Asesor comparten «Paso K de 11»", () => {
  const c = getCorrespondenciaNumeracionEtapa(5);
  assert.equal(c.etapaInterna, 5);
  assert.equal(c.pasoVisual, 4);
  assert.equal(c.numeracionDifiere, true);
  assert.equal(
    formatPasoOperativoLabel(5),
    "Paso 4 de 11 — Biometría (resultado)",
  );
  assert.equal(formatEtapaMesaLabel(5), formatPasoOperativoLabel(5));
  assert.equal(formatEtapaAsesorPasoLabel(5), formatPasoOperativoLabel(5));
  assert.equal(formatEtapaMesaCorrespondenciaAsesor(5), null);
  assert.match(formatEtapaAsesorCorrespondenciaMesa(5), /Etapa interna 5/);
});

test("etapa legacy 4 se muestra como paso 3", () => {
  const c = getCorrespondenciaNumeracionEtapa(4);
  assert.equal(c.etapaInterna, 4);
  assert.equal(c.pasoVisual, 3);
  assert.equal(formatPasoOperativoLabel(4), "Paso 3 de 11 — Listo para cita de biométrico");
  assert.equal(formatEtapaMesaCorrespondenciaAsesor(4), null);
});

test("etapa interna 12 → paso 11 (Pago a ConCasa)", () => {
  assert.equal(mapEtapaInternaAPasoVisual(12), 11);
  assert.equal(
    formatPasoOperativoLabel(12),
    "Paso 11 de 11 — Pago a ConCasa",
  );
  assert.ok(!formatPasoOperativoLabel(12).includes("Etapa 12"));
});

test("bandeja Mesa: solo paso visible, sin hint asesor", () => {
  const same = formatEtapaMesaBandejaBadge(2);
  assert.equal(same.hintAsesor, null);
  assert.equal(same.principal, "Paso 2 de 11 — Registro");

  const diff = formatEtapaMesaBandejaBadge(5);
  assert.equal(diff.hintAsesor, null);
  assert.equal(diff.principal, "Paso 4 de 11 — Biometría (resultado)");
});

test("filtro: 11 opciones; paso 3 → internas [3,4]; paso 4 → [5]", () => {
  const opts = opcionesFiltroPasoOperativo();
  assert.equal(opts.length, 11);
  assert.ok(!opts.some((o) => o.label.includes("Etapa 12")));
  assert.deepEqual(etapasInternasParaPasoVisual(3), [3, 4]);
  assert.deepEqual(etapasInternasParaFiltroPaso("3"), [3, 4]);
  assert.deepEqual(etapasInternasParaFiltroPaso("4"), [5]);
  assert.deepEqual(etapasInternasParaFiltroPaso("11"), [12]);
  assert.equal(etapasInternasParaFiltroPaso("todas"), null);
});

test("destino manual usa etiqueta visible (interna 4 = Paso 3)", () => {
  assert.equal(
    formatPasoOperativoDestinoLabel(4),
    "Paso 3 de 11 — Listo para cita de biométrico",
  );
  assert.equal(
    formatPasoOperativoDestinoLabel(3),
    "Paso 3 de 11 — Listo para cita de biométrico",
  );
});

test("P106: selector movimiento manual — 11 pasos únicos; nunca interna 4", () => {
  const all = opcionesMovimientoManualPaso();
  assert.equal(all.length, 11);
  const pasos = all.map((o) => o.pasoVisual);
  assert.deepEqual(pasos, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(new Set(pasos).size, 11);
  assert.ok(!all.some((o) => o.etapaInternaDestino === 4));
  assert.ok(!all.some((o) => o.label.includes("Etapa 12")));
  assert.ok(!all.some((o) => /Cita agendada/.test(o.label)));

  const paso3 = all.find((o) => o.pasoVisual === 3);
  assert.equal(paso3?.etapaInternaDestino, 3);
  assert.match(paso3!.label, /Listo para cita de biométrico/);

  const paso4 = all.find((o) => o.pasoVisual === 4);
  assert.equal(paso4?.etapaInternaDestino, 5);
  assert.match(paso4!.label, /Biometría \(resultado\)/);

  const paso11 = all.find((o) => o.pasoVisual === 11);
  assert.equal(paso11?.etapaInternaDestino, 12);
  assert.match(paso11!.label, /Pago a ConCasa/);

  const sinPaso3 = opcionesMovimientoManualPaso({ excluirPasoVisualActual: 3 });
  assert.equal(sinPaso3.length, 10);
  assert.ok(!sinPaso3.some((o) => o.pasoVisual === 3));
});

test("nota de numeración documenta 11 pasos y etapa_actual", () => {
  assert.match(NOTA_NUMERACION_ETAPAS, /11 pasos/);
  assert.match(NOTA_NUMERACION_ETAPAS, /etapa_actual/);
});
