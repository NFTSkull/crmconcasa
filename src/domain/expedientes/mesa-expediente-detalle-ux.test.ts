import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgendaAccordionSummary,
  buildClienteDatosAccordionSummary,
  buildIntegracionDocsAccordionSummary,
} from "@/components/mesa-control/MesaExpedienteDocumentosResumen";
import {
  mesaPuedeRevisarClienteDatos,
  mesaPuedeRevisarDocumentosIntegracion,
  mesaPuedeRevisarRetencionDocumentos,
  mostrarMesaClienteDatosConsulta,
  mostrarMesaIntegracionDocsConsulta,
  mostrarMesaRetencionConsulta,
} from "@/domain/expedientes/mesa-decision-ux";

describe("mesa expediente detalle — consulta siempre visible", () => {
  it("datos generales consultables en etapas 4, 8 y 10", () => {
    assert.equal(mostrarMesaClienteDatosConsulta(), true);
    assert.match(
      buildClienteDatosAccordionSummary({ tieneDatos: true, estado: "validado" }),
      /validado/,
    );
    assert.match(
      buildClienteDatosAccordionSummary({ tieneDatos: false, estado: null }),
      /Sin datos generales/,
    );
  });

  it("documentos integración consultables en etapas 4, 8 y 10", () => {
    assert.equal(mostrarMesaIntegracionDocsConsulta(), true);
    const summary = buildIntegracionDocsAccordionSummary([
      {
        tipo_documento: "nss",
        label: "NSS",
        opcional: false,
        estatus_revision: "validado",
        comentario_mesa: null,
        archivo: null,
      },
    ] as never);
    assert.match(summary, /1 documentos/);
    assert.match(summary, /1 validados/);
  });

  it("retención visible en etapa 8+ o con meta", () => {
    assert.equal(
      mostrarMesaRetencionConsulta({ etapaActual: 8, tieneRetencionMeta: false }),
      true,
    );
    assert.equal(
      mostrarMesaRetencionConsulta({ etapaActual: 10, tieneRetencionMeta: false }),
      true,
    );
    assert.equal(
      mostrarMesaRetencionConsulta({ etapaActual: 4, tieneRetencionMeta: true }),
      true,
    );
    assert.equal(
      mostrarMesaRetencionConsulta({ etapaActual: 4, tieneRetencionMeta: false }),
      false,
    );
  });
});

describe("mesa expediente detalle — acciones por etapa", () => {
  it("validar datos solo etapa 1", () => {
    assert.equal(mesaPuedeRevisarClienteDatos(1), true);
    assert.equal(mesaPuedeRevisarClienteDatos(4), false);
    assert.equal(mesaPuedeRevisarClienteDatos(10), false);
  });

  it("validar documentos integración solo etapa 1", () => {
    assert.equal(mesaPuedeRevisarDocumentosIntegracion(1), true);
    assert.equal(mesaPuedeRevisarDocumentosIntegracion(8), false);
  });

  it("validar retención solo etapa 8 enviada", () => {
    assert.equal(mesaPuedeRevisarRetencionDocumentos(8, true), false);
    assert.equal(mesaPuedeRevisarRetencionDocumentos(8, false), false);
    assert.equal(mesaPuedeRevisarRetencionDocumentos(9, true), false);
    assert.equal(mesaPuedeRevisarRetencionDocumentos(10, true), false);
  });
});

describe("mesa expediente detalle — resumen agenda", () => {
  it("etapa 10 muestra firma pendiente de resultado", () => {
    const summary = buildAgendaAccordionSummary({
      etapaActual: 10,
      biometricBooking: null,
      firmasBooking: null,
      fechaCita: "2026-06-30T15:00:00.000Z",
    });
    assert.match(summary, /Firma pendiente de resultado/);
  });
});
