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
      advisorChangesDetailStatus: "loading",
    });
    assert.equal(card.detalleLoading, true);
    assert.equal(card.detalleNoDisponible, false);
    assert.equal(card.detalleError, false);
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
      advisorChangesDetailStatus: "success",
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
      advisorChangesDetailStatus: "success",
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
      advisorChangesDetailStatus: "success",
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
      advisorChangesDetailStatus: "success",
    });
    assert.equal(card.batchMismatch, true);
    assert.equal(card.resumenLines.length, 0);
    assert.equal(card.detalleError, false);
    assert.equal(card.detalleRetryAvailable, true);
  });

  it("P207.3 F7: enrich falla con lote primario → error de carga, sin solicitud Mesa", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesDetailStatus: "error",
      enrichFailed: true,
    });
    assert.equal(card.detalleError, true);
    assert.equal(card.detalleRetryAvailable, true);
    assert.equal(card.solicitadaAt, null);
    assert.equal(card.detalleNoDisponible, false);
    assert.match(card.header, /Actualización del asesor/);
    assert.equal(card.header.includes("detalle no disponible"), false);
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
      advisorChangesDetailStatus: "success",
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
      advisorChangesDetailStatus: "success",
    });
    assert.equal(card.estadoPorRevisar, true);
    assert.equal(card.historicaFirmadoBadge, null);
  });

  it("P207.4 F1: primary batch + loading → Cargando detalle", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      primaryCambioBatchId: "a8348100-28ec-419e-bd0e-bdfdde211a39",
      advisorChangesDetailStatus: "loading",
    });
    assert.equal(card.detalleLoading, true);
    assert.match(card.header, /Corrección recibida/);
  });

  it("P207.4 F2: RPC success + exact batch + 1 change → detalle visible", () => {
    const batchId = "a8348100-28ec-419e-bd0e-bdfdde211a39";
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      primaryCambioBatchId: batchId,
      advisorChangeBatchId: batchId,
      advisorChangesCount: 1,
      advisorChangesSummary: ["Estado de cuenta reemplazado"],
      advisorChangesDetailStatus: "success",
    });
    assert.match(card.header, /Corrección recibida · 1 cambio/);
    assert.deepEqual(card.resumenLines, ["Estado de cuenta reemplazado"]);
    assert.equal(card.detalleError, false);
    assert.equal(card.showRevisarCambios, true);
  });

  it("P207.4 F3: Lorena fixture → Estado de cuenta reemplazado visible", () => {
    const batchId = "a8348100-28ec-419e-bd0e-bdfdde211a39";
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      etapaActual: 9,
      primaryCambioBatchId: batchId,
      advisorChangeBatchId: batchId,
      advisorChangesCount: 1,
      advisorChangesSubmittedAt: "2026-08-12T21:27:15.983Z",
      cambioRequestAt: "2026-08-12T17:53:37.102Z",
      advisorChangesPreview: [
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
      advisorChangesDetailStatus: "success",
    });
    assert.deepEqual(card.resumenLines, ["Estado de cuenta reemplazado"]);
    assert.ok(card.solicitadaAt);
    assert.ok(card.loteAt);
    assert.equal(card.header.includes("detalle no disponible"), false);
  });

  it("P207.4 F4/F5: RPC error → no detalle no disponible + error copy", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      primaryCambioBatchId: "a8348100-28ec-419e-bd0e-bdfdde211a39",
      advisorChangesDetailStatus: "error",
    });
    assert.equal(card.detalleError, true);
    assert.equal(card.detalleNoDisponible, false);
    assert.equal(card.header.includes("detalle no disponible"), false);
    assert.equal(card.detalleRetryAvailable, true);
  });

  it("P207.4 F6: retry success → detalle visible", () => {
    const batchId = "a8348100-28ec-419e-bd0e-bdfdde211a39";
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      primaryCambioBatchId: batchId,
      advisorChangeBatchId: batchId,
      advisorChangesCount: 1,
      advisorChangesSummary: ["Estado de cuenta reemplazado"],
      advisorChangesDetailStatus: "success",
    });
    assert.deepEqual(card.resumenLines, ["Estado de cuenta reemplazado"]);
  });

  it("P207.4 F7: retry fails → Reintentar detalle disponible", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      primaryCambioBatchId: "a8348100-28ec-419e-bd0e-bdfdde211a39",
      advisorChangesDetailStatus: "error",
    });
    assert.equal(card.detalleRetryAvailable, true);
  });

  it("P207.4 F8: fallback get lote success → detalle visible", () => {
    const batchId = "a8348100-28ec-419e-bd0e-bdfdde211a39";
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      primaryCambioBatchId: batchId,
      advisorChangeBatchId: batchId,
      advisorChangesCount: 1,
      advisorChangesSummary: ["Estado de cuenta reemplazado"],
      advisorChangesDetailStatus: "success",
    });
    assert.equal(card.changeDetails, true);
  });

  it("P207.4 F9: batch mismatch real → no usar datos equivocados", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      primaryCambioBatchId: "a8348100-28ec-419e-bd0e-bdfdde211a39",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000099",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Estado de cuenta reemplazado"],
      advisorChangesDetailStatus: "success",
    });
    assert.equal(card.batchMismatch, true);
    assert.equal(card.resumenLines.length, 0);
  });

  it("P207.4 F10: success empty + no primary batch histórico → detalle no disponible", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 0,
      resumenDocumental: "faltantes",
      advisorChangesDetailStatus: "success",
    });
    assert.equal(card.detalleNoDisponible, true);
    assert.match(card.header, /detalle no disponible/);
  });

  it("P207.4 F11: ADVISOR_UPDATE → no Solicitud Mesa falsa", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangeBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Referencias actualizadas"],
      correctionRequestedAt: "2026-08-05T16:41:00.000Z",
      advisorChangesDetailStatus: "success",
    });
    assert.equal(card.solicitadaAt, null);
  });

  it("P207.4 F12: REQUESTED_CORRECTION → conserva Solicitud Mesa", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      cambioRequestAt: "2026-08-10T12:00:00.000Z",
      primaryCambioBatchId: "a8348100-28ec-419e-bd0e-bdfdde211a39",
      advisorChangeBatchId: "a8348100-28ec-419e-bd0e-bdfdde211a39",
      advisorChangesCount: 1,
      advisorChangesDetailStatus: "success",
    });
    assert.ok(card.solicitadaAt);
  });

  it("P207.4 F13: Firmado histórico P207.3 → sin regresión", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      origin: "ADVISOR_UPDATE",
      etapaActual: 11,
      primaryCambioBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangeBatchId: "cf197c83-c29f-4e83-a46c-190ca7df1e64",
      advisorChangesCount: 1,
      advisorChangesSummary: ["Referencias actualizadas"],
      advisorChangesDetailStatus: "success",
    });
    assert.equal(card.firmadoHistorico, true);
    assert.equal(card.estadoPorRevisar, false);
  });
});
