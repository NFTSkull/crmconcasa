import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  ASESOR_INBOX_DOCUMENTACION_COL_HEADER,
  ASESOR_INBOX_DOCUMENTACION_COL_TITLE,
  asesorDocumentacionFilaBadge,
  asesorEstatusOperativoFilaBadge,
  asesorInboxFilaEstadoLabels,
  asesorEstadoActualFilaBadge,
  asesorResultadoFilaBadge,
} from "./asesor-inbox-fila-badges";
import { getAsesorInboxEstadoEfectivoPresentation } from "./asesor-inbox-estado-efectivo";

function isGreenSuccess(className: string): boolean {
  return className.includes("bg-green-100") && className.includes("text-green-800");
}

const COMPLETOS_PILL =
  "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800";

describe("P197-B2 estado actual desde estado_efectivo", () => {
  it("U1 correccion_requerida → Necesita corrección", () => {
    const b = asesorEstadoActualFilaBadge("correccion_requerida");
    assert.equal(b.label, "Necesita corrección");
  });

  it("U2 enviada gana aunque resultado_real/subestado sean rechazo", () => {
    const fila = asesorInboxFilaEstadoLabels({
      estadoEfectivo: "correccion_enviada",
      resultadoReal: "rechazado_mesa",
      resumenCorreccion: "correccion_enviada",
      subestado: "rechazado",
      cicloEstado: "activo",
      etapaActual: 2,
      etapaDisplay: "2. Registro",
    });
    assert.equal(fila.estadoActual, "Corrección enviada");
    assert.notEqual(fila.estadoActual, "Rechazado por Mesa");
    assert.equal(fila.estatus, null);
  });

  it("U3 en_tramite + categoria enviada (ADVISOR_UPDATE) no pinta chip global enviada", () => {
    const fila = asesorInboxFilaEstadoLabels({
      estadoEfectivo: "en_tramite",
      resultadoReal: "en_tramite",
      resumenCorreccion: "correccion_enviada",
      documentacionLabel: "Completos",
      documentacionClassName: COMPLETOS_PILL,
      subestado: "en_proceso",
      cicloEstado: "activo",
      etapaActual: 11,
      etapaDisplay: "11. Firmado",
    });
    assert.equal(fila.estadoActual, "En trámite");
    // P202: episodio cerrado/normal → documentación real, no overlay histórico
    assert.equal(fila.documentacion, "Completos");
  });

  it("U4 rechazado_mesa → Rechazado por Mesa", () => {
    assert.equal(
      asesorEstadoActualFilaBadge("rechazado_mesa").label,
      "Rechazado por Mesa",
    );
  });

  it("U5 cancelado gana sobre categoría vieja", () => {
    const fila = asesorInboxFilaEstadoLabels({
      estadoEfectivo: "cancelado",
      resultadoReal: "cancelado",
      resumenCorreccion: "correccion_requerida",
      subestado: "rechazado",
      cicloEstado: "cancelado",
      etapaActual: 2,
      etapaDisplay: "2. Registro",
    });
    assert.equal(fila.estadoActual, "Cancelado");
    assert.equal(fila.estatus, null);
  });

  it("U6–U8 presentation ignora categoria, resultado_real y subestado", () => {
    const a = getAsesorInboxEstadoEfectivoPresentation("en_tramite");
    const b = getAsesorInboxEstadoEfectivoPresentation("en_tramite");
    assert.equal(a.label, "En trámite");
    assert.deepEqual(a, b);
    assert.equal(
      asesorEstadoActualFilaBadge("en_tramite").label,
      "En trámite",
    );
    assert.notEqual(
      asesorEstadoActualFilaBadge("en_tramite").label,
      asesorDocumentacionFilaBadge("—", "", "correccion_enviada").label,
    );
    assert.notEqual(
      asesorEstadoActualFilaBadge("correccion_enviada").label,
      "Rechazado por Mesa",
    );
  });

  it("Documentación Corrección enviada es texto emerald, no pill", () => {
    const doc = asesorDocumentacionFilaBadge("—", "", "correccion_enviada");
    assert.equal(doc.label, "Corrección enviada");
    assert.match(doc.className, /text-emerald-700/);
    assert.match(doc.className, /font-semibold|font-medium/);
    assert.doesNotMatch(doc.className, /bg-emerald|border-emerald|rounded-full/);
  });

  it("V1 no duplica Rechazado en estatus cuando necesita corrección", () => {
    const estatus = asesorEstatusOperativoFilaBadge(
      "rechazado",
      "correccion_requerida",
      "activo",
      2,
      null,
    );
    assert.equal(estatus, null);
  });
});

describe("P184 asesor inbox fila etapa 12 pago ConCasa", () => {
  it("A) 12 + pagado: Completado/Pagado verde; no En trámite/En proceso", () => {
    const resultado = asesorResultadoFilaBadge("en_tramite", 12, "pagado");
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      "en_tramite",
      "activo",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Completado");
    assert.ok(isGreenSuccess(resultado.className));
    assert.equal(estatus?.label, "Pagado");
    assert.notEqual(resultado.label, "En trámite");
    assert.notEqual(estatus?.label, "En proceso");
  });

  it("B) 12 + no_pagado: Finalizado / No pagó; sin verde de pagado", () => {
    const resultado = asesorResultadoFilaBadge("en_tramite", 12, "no_pagado");
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      "en_tramite",
      "activo",
      12,
      "no_pagado",
    );
    assert.equal(resultado.label, "Finalizado");
    assert.equal(estatus?.label, "No pagó");
    assert.ok(!isGreenSuccess(resultado.className));
    assert.notEqual(resultado.label, "En trámite");
    assert.notEqual(estatus?.label, "En proceso");
    assert.notEqual(resultado.label, "Rechazado por Mesa");
    assert.notEqual(resultado.label, "Cancelado");
    assert.notEqual(resultado.label, "No cumple (editor)");
  });

  it("C) 12 + null: no infiere pagado", () => {
    const resultado = asesorResultadoFilaBadge("en_tramite", 12, null);
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      "en_tramite",
      "activo",
      12,
      null,
    );
    assert.equal(resultado.label, "En trámite");
    assert.equal(estatus?.label, "En proceso");
    assert.notEqual(resultado.label, "Completado");
    assert.notEqual(estatus?.label, "Pagado");
  });

  it("D) etapa 11 sin pago: contrato actual En trámite / En proceso", () => {
    const resultado = asesorResultadoFilaBadge("en_tramite", 11, null);
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      "en_tramite",
      "activo",
      11,
      null,
    );
    assert.equal(resultado.label, "En trámite");
    assert.equal(estatus?.label, "En proceso");
  });

  it("E) cancelado tiene prioridad sobre pagado", () => {
    const resultado = asesorResultadoFilaBadge("cancelado", 12, "pagado");
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      "cancelado",
      "cancelado",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Cancelado");
    assert.equal(estatus, null);
  });

  it("F) rechazo Mesa vigente: Estado actual, sin chip Estatus duplicado", () => {
    const resultado = asesorResultadoFilaBadge("rechazado_mesa", 12, "pagado");
    const estatus = asesorEstatusOperativoFilaBadge(
      "rechazado",
      "rechazado_mesa",
      "activo",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Rechazado por Mesa");
    assert.equal(estatus, null);
  });

  it("G) pagado no cambia badge de documentación (columna independiente)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
    const docCall = src.slice(
      src.indexOf("asesorDocumentacionFilaBadge("),
      src.indexOf("asesorDocumentacionFilaBadge(") + 280,
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
      estadoEfectivo: "en_tramite",
      etapaActual: 12,
      pagoConcasaResultado: "pagado",
      subestado: "en_proceso",
      cicloEstado: "activo",
      etapaDisplay,
    });
    const rendered = `${fila.estadoActual} | ${fila.estatus} | ${fila.etapa}`;
    assert.match(rendered, /Completado/);
    assert.match(rendered, /Pagado/);
    assert.match(rendered, /Pagó/);
    assert.doesNotMatch(rendered, /En trámite/);
    assert.doesNotMatch(rendered, /En proceso/);

    const page = readFileSync(resolve(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
    assert.match(page, /asesorEstadoActualFilaBadge\(/);
    assert.match(page, /estadoEfectivo/);
    assert.match(page, /asesorInboxReprecalBadgeLabel/);
    assert.match(page, /Monto actualizado/);
  });

  it("pagado gana sobre corrección documental en resultado/estatus", () => {
    const resultado = asesorResultadoFilaBadge("en_tramite", 12, "pagado");
    const estatus = asesorEstatusOperativoFilaBadge(
      "en_proceso",
      "en_tramite",
      "activo",
      12,
      "pagado",
    );
    assert.equal(resultado.label, "Completado");
    assert.equal(estatus?.label, "Pagado");
  });
});

describe("asesor inbox documentación/corrección claridad visual", () => {
  it("U1 correccion_requerida: label y ámbar oscuro sin opacity /80", () => {
    const doc = asesorDocumentacionFilaBadge("—", "", "correccion_requerida");
    assert.equal(doc.label, "Necesita corrección");
    assert.match(doc.className, /text-amber-800|text-amber-900/);
    assert.doesNotMatch(doc.className, /\/80/);
    assert.match(doc.className, /font-semibold/);
    assert.doesNotMatch(doc.className, /bg-amber|rounded-full/);
  });

  it("U2 correccion_enviada: emerald y peso legible", () => {
    const doc = asesorDocumentacionFilaBadge("—", "", "correccion_enviada");
    assert.equal(doc.label, "Corrección enviada");
    assert.match(doc.className, /text-emerald-700/);
    assert.match(doc.className, /font-semibold|font-medium/);
  });

  it("U3 Necesita: docs = Pendiente de corregir (nunca Corrección enviada histórica)", () => {
    const fila = asesorInboxFilaEstadoLabels({
      estadoEfectivo: "correccion_requerida",
      resumenCorreccion: "correccion_enviada",
      etapaDisplay: "2. Registro",
    });
    assert.equal(fila.estadoActual, "Necesita corrección");
    assert.equal(fila.documentacion, "Pendiente de corregir");
    assert.notEqual(fila.documentacion, "Corrección enviada");
  });

  it("U4 Necesita: overlay chip gana sobre Completos documental", () => {
    const fila = asesorInboxFilaEstadoLabels({
      estadoEfectivo: "correccion_requerida",
      documentacionLabel: "Completos",
      documentacionClassName: COMPLETOS_PILL,
      etapaDisplay: "2. Registro",
    });
    assert.equal(fila.estadoActual, "Necesita corrección");
    assert.equal(fila.documentacion, "Pendiente de corregir");
    const doc = asesorDocumentacionFilaBadge(
      "Completos",
      COMPLETOS_PILL,
      undefined,
      "correccion_requerida",
    );
    assert.equal(doc.label, "Pendiente de corregir");
  });

  it("U5 en_tramite + Completos sin regresión", () => {
    const fila = asesorInboxFilaEstadoLabels({
      estadoEfectivo: "en_tramite",
      documentacionLabel: "Completos",
      documentacionClassName: COMPLETOS_PILL,
      etapaDisplay: "2. Registro",
    });
    assert.equal(fila.estadoActual, "En trámite");
    assert.equal(fila.documentacion, "Completos");
  });

  it("P202 Enviada: docs = Enviada a Mesa", () => {
    const fila = asesorInboxFilaEstadoLabels({
      estadoEfectivo: "correccion_enviada",
      resumenCorreccion: "correccion_requerida",
      etapaDisplay: "2. Registro",
    });
    assert.equal(fila.estadoActual, "Corrección enviada");
    assert.equal(fila.documentacion, "Enviada a Mesa");
  });

  it("encabezado Documentación / corrección y tooltip de divergencia", () => {
    assert.equal(ASESOR_INBOX_DOCUMENTACION_COL_HEADER, "Documentación / corrección");
    assert.match(
      ASESOR_INBOX_DOCUMENTACION_COL_TITLE,
      /Puede diferir del Estado actual/,
    );
    const page = readFileSync(resolve(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
    assert.match(page, /ASESOR_INBOX_DOCUMENTACION_COL_HEADER/);
    assert.match(page, /ASESOR_INBOX_DOCUMENTACION_COL_TITLE/);
    assert.match(page, /estadoEfectivo/);
    assert.match(
      page,
      /if \(c === "faltantes"\) \{\s*return "inline-flex rounded-full bg-gray-100 px-2 py-0\.5 text-xs font-medium text-gray-700";/,
    );
  });
});
