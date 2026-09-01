import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMesaAsesorCambiosCardModel,
  MESA_CAMBIO_HISTORICA_FIRMADO,
} from "./mesaAsesorCambiosCardUi";
import {
  MESA_ASESOR_CAMBIOS_HISTORY_EXACT_BADGE,
  MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_BODY,
  MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_TITLE,
} from "./mesaAsesorCambiosUi";
import { MESA_CAMBIO_CTA_VER_CAMBIOS } from "./mesaCambiosRevisionOrigenUi";

describe("mesaAsesorCambiosCardUi", () => {
  it("P130 1 campo → header origen · 1 cambio + 1 bullet", () => {
    const card = buildMesaAsesorCambiosCardModel({
      origin: "ADVISOR_UPDATE",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 1,
      advisorChangesPreview: [
        {
          tipo: "campo_actualizado",
          campo: "plazo",
          documentKind: null,
          label: "Plazo actualizado",
          hasOld: true,
          hasNew: true,
          source: "P130",
        },
      ],
      resumenDocumental: "correccion_enviada",
    });
    assert.match(card.header, /Actualización del asesor · 1 cambio/);
    assert.deepEqual(card.resumenLines, ["Plazo actualizado"]);
    assert.equal(card.showRevisarCambios, true);
  });

  it("P130 3 campos → preview 3, requested copy", () => {
    const card = buildMesaAsesorCambiosCardModel({
      origin: "REQUESTED_CORRECTION",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 3,
      advisorChangesPreview: [
        {
          tipo: "campo_actualizado",
          campo: "plazo",
          documentKind: null,
          label: "Plazo actualizado",
          hasOld: true,
          hasNew: true,
          source: "P130",
        },
        {
          tipo: "campo_actualizado",
          campo: "notaMesa",
          documentKind: null,
          label: "Notas para Mesa actualizadas",
          hasOld: true,
          hasNew: true,
          source: "P130",
        },
        {
          tipo: "documento_reemplazado",
          campo: null,
          documentKind: "cliente_estado_cuenta",
          label: "Estado de cuenta reemplazado",
          hasOld: true,
          hasNew: true,
          source: "P130",
        },
      ],
      resumenDocumental: "correccion_enviada",
    });
    assert.match(card.header, /Corrección por revisar · 3 cambios/);
    assert.equal(card.resumenLines.length, 3);
    assert.equal(card.estadoPorRevisar, true);
  });

  it("P130 5 cambios → 3 bullets + +2 cambios más", () => {
    const card = buildMesaAsesorCambiosCardModel({
      origin: "ADVISOR_UPDATE",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 5,
      advisorChangesPreview: [
        { tipo: "campo_actualizado", campo: "plazo", documentKind: null, label: "Plazo actualizado", hasOld: true, hasNew: true, source: "P130" },
        { tipo: "campo_actualizado", campo: "notaMesa", documentKind: null, label: "Notas para Mesa actualizadas", hasOld: true, hasNew: true, source: "P130" },
        { tipo: "documento_reemplazado", campo: null, documentKind: "cliente_comprobante_domicilio", label: "Comprobante de domicilio reemplazado", hasOld: true, hasNew: true, source: "P130" },
      ],
      resumenDocumental: "correccion_enviada",
    });
    assert.deepEqual(card.resumenLines, [
      "Plazo actualizado",
      "Notas para Mesa actualizadas",
      "Comprobante de domicilio reemplazado",
      "+2 cambios más",
    ]);
  });

  it("campo sensible: solo label, sin valores", () => {
    const card = buildMesaAsesorCambiosCardModel({
      origin: "ADVISOR_UPDATE",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 1,
      advisorChangesPreview: [
        {
          tipo: "campo_actualizado",
          campo: "rfc",
          documentKind: null,
          label: "RFC actualizado",
          hasOld: true,
          hasNew: true,
          source: "P130",
        },
      ],
      resumenDocumental: "correccion_enviada",
    });
    assert.deepEqual(card.resumenLines, ["RFC actualizado"]);
    assert.equal(JSON.stringify(card.resumenLines).includes("valor"), false);
  });

  it("AMBIGUOUS / LEGACY muestran detalle P130 si existe", () => {
    for (const origin of ["AMBIGUOUS", "LEGACY"] as const) {
      const card = buildMesaAsesorCambiosCardModel({
        origin,
        advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
        advisorChangesCount: 2,
        advisorChangesPreview: [
          {
            tipo: "campo_actualizado",
            campo: "plazo",
            documentKind: null,
            label: "Plazo actualizado",
            hasOld: true,
            hasNew: true,
            source: "P130",
          },
        ],
        resumenDocumental: "correccion_enviada",
      });
      assert.equal(card.changeDetails, true);
      assert.ok(card.resumenLines.length > 0);
    }
  });

  it("Natividad-like EXACT: 1 cambio + badge historial", () => {
    const card = buildMesaAsesorCambiosCardModel({
      origin: "ADVISOR_UPDATE",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 0,
      historyConfidence: "EXACT",
      advisorChangesPreview: [
        {
          tipo: "documento_reemplazado",
          campo: null,
          documentKind: "cliente_comprobante_domicilio",
          label: "Comprobante de domicilio reemplazado",
          hasOld: true,
          hasNew: true,
          source: "HISTORY_RECOVERED",
        },
      ],
      resumenDocumental: "correccion_enviada",
    });
    assert.match(card.header, /Actualización del asesor · 1 cambio/);
    assert.equal(card.historyBadge, MESA_ASESOR_CAMBIOS_HISTORY_EXACT_BADGE);
    assert.equal(card.showRevisarCambios, true);
  });

  it("PARTIAL no inventa campo", () => {
    const card = buildMesaAsesorCambiosCardModel({
      origin: "ADVISOR_UPDATE",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 0,
      historyConfidence: "PARTIAL",
      resumenDocumental: "correccion_enviada",
    });
    assert.equal(card.historyTitle, MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_TITLE);
    assert.equal(card.showRevisarCambios, false);
    assert.equal(card.header.includes("1 cambio"), false);
  });

  it("NO_DIFF no cuenta 1 cambio", () => {
    const card = buildMesaAsesorCambiosCardModel({
      origin: "ADVISOR_UPDATE",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 0,
      historyConfidence: "NO_DIFF",
      resumenDocumental: "correccion_enviada",
    });
    assert.equal(card.historyBody, MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_BODY);
    assert.equal(card.header.includes("1 cambio"), false);
    assert.equal(card.showRevisarCambios, false);
  });

  it("P198 M1: corrección activa muestra bloque aunque Documentación sea Faltantes", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 1,
      advisorChangesSubmittedAt: "2026-08-17T12:00:00.000Z",
      cambioRequestAt: "2026-08-10T12:00:00.000Z",
      cambioRequestType: "SOLICITUD_DATOS_GENERALES",
      advisorChangesPreview: [
        {
          tipo: "campo_actualizado",
          campo: "plazo",
          documentKind: null,
          label: "Plazo actualizado",
          hasOld: true,
          hasNew: true,
          source: "P130",
        },
      ],
      resumenDocumental: "faltantes",
    });
    assert.equal(card.showBlock, true);
    assert.match(card.header, /Corrección recibida/);
    assert.equal(card.tipoHumano, "Datos generales");
    assert.equal(card.showRevisarCambios, true);
  });

  it("P198 M13: enrich falla y el bloque no desaparece", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 0,
      resumenDocumental: "faltantes",
    });
    assert.equal(card.showBlock, true);
    assert.equal(card.detalleNoDisponible, true);
    assert.match(card.header, /detalle no disponible/);
    assert.equal(card.showAbrirExpediente, true);
  });

  it("P198 CLOSED no pinta tarjeta por resumenDocumental", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CLOSED",
      origin: "REQUESTED_CORRECTION",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 1,
      resumenDocumental: "correccion_enviada",
    });
    assert.equal(card.showBlock, false);
  });

  it("P207.3 F2: pending + cambioBatchId primario + enrich loading → cargando, no detalle no disponible", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesHydrated: false,
    });
    assert.equal(card.detalleLoading, true);
    assert.equal(card.detalleNoDisponible, false);
    assert.match(card.header, /Actualización del asesor/);
  });

  it("P207.3 F3: ADVISOR_UPDATE summary Luis-like", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      etapaActual: 10,
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangeBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Referencias actualizadas"],
      advisorChangesSubmittedAt: "2026-08-07T02:50:21.000Z",
      advisorChangesHydrated: true,
    });
    assert.match(card.header, /Actualización del asesor · 1 cambio/);
    assert.deepEqual(card.resumenLines, ["Referencias actualizadas"]);
    assert.equal(card.estadoPorRevisar, true);
    assert.equal(card.solicitadaAt, null);
  });

  it("P207.3 F4: ADVISOR_UPDATE no muestra solicitud Mesa histórica", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangeBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Referencias actualizadas"],
      correctionRequestedAt: "2026-08-05T16:41:00.000Z",
      correctionRequestedByName: "Mesa Admin",
      correctionRequestedReason: "Documento ilegible",
      advisorChangesHydrated: true,
    });
    assert.equal(card.solicitadaAt, null);
    assert.equal(card.solicitadaPor, null);
    assert.equal(card.motivo, null);
  });

  it("P207.3 F5: REQUESTED_CORRECTION conserva fecha/motivo Mesa", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      cambioRequestAt: "2026-08-10T12:00:00.000Z",
      cambioRequestType: "SOLICITUD_DATOS_GENERALES",
      correctionRequestedReason: "RFC inválido",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 1,
      advisorChangesHydrated: true,
    });
    assert.ok(card.solicitadaAt);
    assert.equal(card.motivo, "RFC inválido");
    assert.equal(card.tipoHumano, "Datos generales");
  });

  it("P207.3 F6: batch mismatch no expone cambios de otro lote", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000099",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Plazo actualizado"],
      advisorChangesHydrated: true,
    });
    assert.equal(card.batchMismatch, true);
    assert.equal(card.resumenLines.length, 0);
    assert.equal(card.detalleTemporalNoDisponible, true);
  });

  it("P207.3 F7: enrich falla con lote primario → detalle temporal, sin solicitud Mesa", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesHydrated: true,
      enrichFailed: true,
    });
    assert.equal(card.detalleTemporalNoDisponible, true);
    assert.equal(card.solicitadaAt, null);
    assert.equal(card.detalleNoDisponible, false);
  });

  it("P207.3 F8: Firmado etapa11 histórico visible sin Por revisar", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      etapaActual: 11,
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangeBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Referencias actualizadas"],
      advisorChangesHydrated: true,
    });
    assert.equal(card.firmadoHistorico, true);
    assert.equal(card.estadoPorRevisar, false);
    assert.equal(card.historicaFirmadoBadge, MESA_CAMBIO_HISTORICA_FIRMADO);
    assert.equal(card.ctaLabel, MESA_CAMBIO_CTA_VER_CAMBIOS);
  });

  it("P207.3 F9: etapa10 pending sí Por revisar", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      etapaActual: 10,
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangeBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Referencias actualizadas"],
      advisorChangesHydrated: true,
    });
    assert.equal(card.estadoPorRevisar, true);
    assert.equal(card.historicaFirmadoBadge, null);
  });
});
