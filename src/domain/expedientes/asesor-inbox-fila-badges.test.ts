import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  asesorEstatusOperativoFilaBadge,
  asesorInboxFilaEstadoLabels,
  asesorResultadoFilaBadge,
} from "./asesor-inbox-fila-badges";

function isGreenSuccess(className: string): boolean {
  return className.includes("bg-green-100") && className.includes("text-green-800");
}

describe("P184 asesor inbox fila etapa 12 pago ConCasa", () => {
  it("A) 12 + pagado: Completado/Pagado verde; no En trámite/En proceso", () => {
    const resultado = asesorResultadoFilaBadge(
      "en_tramite",
      undefined,
      12,
      "pagado",
    );
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      undefined,
      "activo",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Completado");
    assert.ok(isGreenSuccess(resultado.className));
    assert.equal(estatus.label, "Pagado");
    assert.ok(isGreenSuccess(estatus.className));
    assert.notEqual(resultado.label, "En trámite");
    assert.notEqual(estatus.label, "En proceso");
  });

  it("B) 12 + no_pagado: Finalizado / No pagó; sin verde de pagado", () => {
    const resultado = asesorResultadoFilaBadge(
      "en_tramite",
      undefined,
      12,
      "no_pagado",
    );
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      undefined,
      "activo",
      12,
      "no_pagado",
    );
    assert.equal(resultado.label, "Finalizado");
    assert.equal(estatus.label, "No pagó");
    assert.ok(!isGreenSuccess(resultado.className));
    assert.ok(!isGreenSuccess(estatus.className));
    assert.notEqual(resultado.label, "En trámite");
    assert.notEqual(estatus.label, "En proceso");
    assert.notEqual(resultado.label, "Rechazado (mesa)");
    assert.notEqual(resultado.label, "Cancelado");
    assert.notEqual(resultado.label, "No cumple (editor)");
  });

  it("C) 12 + null: no infiere pagado", () => {
    const resultado = asesorResultadoFilaBadge("en_tramite", undefined, 12, null);
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      undefined,
      "activo",
      12,
      null,
    );
    assert.equal(resultado.label, "En trámite");
    assert.equal(estatus.label, "En proceso");
    assert.notEqual(resultado.label, "Completado");
    assert.notEqual(estatus.label, "Pagado");
  });

  it("D) etapa 11 sin pago: contrato actual En trámite / En proceso", () => {
    const resultado = asesorResultadoFilaBadge("en_tramite", undefined, 11, null);
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      undefined,
      "activo",
      11,
      null,
    );
    assert.equal(resultado.label, "En trámite");
    assert.equal(estatus.label, "En proceso");
  });

  it("E) cancelado tiene prioridad sobre pagado", () => {
    const resultado = asesorResultadoFilaBadge("cancelado", undefined, 12, "pagado");
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      undefined,
      "cancelado",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Cancelado");
    assert.equal(estatus.label, "Cancelado");
  });

  it("F) rechazo Mesa tiene prioridad sobre pagado", () => {
    const resultado = asesorResultadoFilaBadge(
      "rechazado_mesa",
      undefined,
      12,
      "pagado",
    );
    const estatus = asesorEstatusOperativoFilaBadge(
      "rechazado",
      undefined,
      "activo",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Rechazado (mesa)");
    assert.equal(estatus.label, "Rechazado");
  });

  it("G) pagado no cambia badge de documentación (columna independiente)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
    const docCall = src.slice(
      src.indexOf("asesorDocumentacionFilaBadge("),
      src.indexOf("asesorDocumentacionFilaBadge(") + 220,
    );
    assert.doesNotMatch(docCall, /pagoConcasaResultado/);
    assert.match(docCall, /estadoDocumentacion/);
  });

  it("H) etapaActualToTexto 12 pagado/no_pagado (contrato existente)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
    assert.match(src, /12\. Pago ConCasa · Pagó/);
    assert.match(src, /12\. Pago ConCasa · No pagó/);
    const fnStart = src.indexOf("function etapaActualToTexto");
    const fn = src.slice(fnStart, fnStart + 700);
    assert.match(fn, /pagoConcasaResultado === "pagado"/);
    assert.match(fn, /pagoConcasaResultado === "no_pagado"/);
  });

  it("mount/source: fixture 12 pagado renderiza Completado+Pagado y no En trámite/En proceso", () => {
    const etapaDisplay = "12. Pago ConCasa · Pagó";
    const fila = asesorInboxFilaEstadoLabels({
      resultadoReal: "en_tramite",
      etapaActual: 12,
      pagoConcasaResultado: "pagado",
      subestado: "en_proceso",
      cicloEstado: "activo",
      etapaDisplay,
    });
    const rendered = `${fila.resultado} | ${fila.estatus} | ${fila.etapa}`;
    assert.match(rendered, /Completado/);
    assert.match(rendered, /Pagado/);
    assert.match(rendered, /Pagó/);
    assert.doesNotMatch(rendered, /En trámite/);
    assert.doesNotMatch(rendered, /En proceso/);

    const page = readFileSync(resolve(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
    assert.match(
      page,
      /asesorResultadoFilaBadge\(\s*resultadoReal,\s*resumenCorreccion,\s*p\.etapaActual,\s*p\.operativo\?\.pagoConcasaResultado/,
    );
    assert.match(
      page,
      /asesorEstatusOperativoFilaBadge\([\s\S]*p\.etapaActual,[\s\S]*pagoConcasaResultado/,
    );
    assert.match(page, /asesorInboxReprecalBadgeLabel/);
    assert.match(page, /Monto actualizado/);
  });

  it("pagado gana sobre corrección documental en resultado/estatus", () => {
    const resultado = asesorResultadoFilaBadge(
      "en_tramite",
      "correccion_requerida",
      12,
      "pagado",
    );
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      "correccion_requerida",
      "activo",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Completado");
    assert.equal(estatus.label, "Pagado");
  });
});
