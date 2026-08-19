import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMesaAsesorCambiosCardModel } from "./mesaAsesorCambiosCardUi";
import {
  MESA_ASESOR_CAMBIOS_HISTORY_EXACT_BADGE,
  MESA_ASESOR_CAMBIOS_HISTORY_NO_DIFF_BODY,
  MESA_ASESOR_CAMBIOS_HISTORY_PARTIAL_TITLE,
} from "./mesaAsesorCambiosUi";

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
});
