import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCorreccionSolicitudHistorica,
  formatMesaAsesorCambiosBadge,
  formatMesaAsesorCambiosResumen,
  formatMesaAsesorCambioStatusLabel,
  formatMesaAsesorReenviadoAt,
  formatMesaCorreccionMotivoLine,
  groupMesaAsesorCambio,
  mesaAsesorCambioAnchor,
  MESA_ASESOR_CAMBIOS_ABRIR_EXPEDIENTE_CTA,
  MESA_ASESOR_CAMBIOS_HISTORICO_AVISO,
  MESA_ASESOR_CAMBIOS_HISTORICO_TITULO,
  MESA_ASESOR_CAMBIOS_LOTE_VACIO_AVISO,
  MESA_ASESOR_CAMBIOS_LOTE_VACIO_TITULO,
  MESA_ASESOR_CAMBIOS_MOTIVO_NO_DISPONIBLE,
  esCorreccionHistoricaSinDetalle,
  esLoteAsesorCambiosVacio,
  hasAdvisorChangeDetails,
} from "./mesaAsesorCambiosUi";

describe("mesaAsesorCambiosUi", () => {
  it("badge sin lote → título histórico P130.2", () => {
    assert.equal(
      formatMesaAsesorCambiosBadge(3, false),
      "Corrección histórica pendiente de revisión",
    );
    assert.equal(
      formatMesaAsesorCambiosBadge(null, false),
      MESA_ASESOR_CAMBIOS_HISTORICO_TITULO,
    );
    assert.match(MESA_ASESOR_CAMBIOS_HISTORICO_AVISO, /registro detallado de cambios/);
    assert.equal(
      MESA_ASESOR_CAMBIOS_ABRIR_EXPEDIENTE_CTA,
      "Abrir expediente para revisar",
    );
  });

  it("correccion_enviada sin batch → histórico", () => {
    assert.equal(
      esCorreccionHistoricaSinDetalle({
        resumenDocumental: "correccion_enviada",
        advisorChangeBatchId: null,
      }),
      true,
    );
    assert.equal(
      esCorreccionHistoricaSinDetalle({
        resumenDocumental: "correccion_enviada",
        advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      }),
      false,
    );
    assert.equal(
      esCorreccionHistoricaSinDetalle({
        resumenDocumental: "correccion_requerida",
        advisorChangeBatchId: null,
      }),
      false,
    );
  });

  it("histórico agrega motivo/fechas desde documento_revisiones", () => {
    const actor = "00000000-0000-4000-8000-0000000000aa";
    const doc1 = "00000000-0000-4000-8000-0000000000d1";
    const doc2 = "00000000-0000-4000-8000-0000000000d2";
    const out = aggregateCorreccionSolicitudHistorica(
      [
        {
          expedienteId: "00000000-0000-4000-8000-0000000000e1",
          documentoId: doc1,
          comentarioMesa: "Imagen borrosa",
          actorId: actor,
          createdAt: "2026-07-20T15:00:00.000Z",
        },
        {
          expedienteId: "00000000-0000-4000-8000-0000000000e1",
          documentoId: doc2,
          comentarioMesa: "Documento incompleto",
          actorId: actor,
          createdAt: "2026-07-20T15:05:00.000Z",
        },
        {
          expedienteId: "00000000-0000-4000-8000-0000000000e1",
          documentoId: doc1,
          comentarioMesa: "Motivo viejo",
          actorId: actor,
          createdAt: "2026-07-01T10:00:00.000Z",
        },
      ],
      {
        resubmittedAt: "2026-07-21T12:00:00.000Z",
        actorNameById: new Map([[actor, "Keyla"]]),
      },
    );
    assert.equal(out.correctionRequestedReason, "Imagen borrosa · Documento incompleto");
    assert.equal(out.correctionRequestedNote, null);
    assert.equal(out.correctionRequestedAt, "2026-07-20T15:00:00.000Z");
    assert.equal(out.correctionRequestedByName, "Keyla");
    assert.equal(out.correctionResubmittedAt, "2026-07-21T12:00:00.000Z");
  });

  it("histórico sin motivo → Motivo original no disponible", () => {
    assert.equal(formatMesaCorreccionMotivoLine(null), MESA_ASESOR_CAMBIOS_MOTIVO_NO_DISPONIBLE);
    assert.equal(formatMesaCorreccionMotivoLine(""), MESA_ASESOR_CAMBIOS_MOTIVO_NO_DISPONIBLE);
    const empty = aggregateCorreccionSolicitudHistorica([]);
    assert.equal(empty.correctionRequestedReason, null);
    assert.equal(
      formatMesaCorreccionMotivoLine(empty.correctionRequestedReason),
      "Motivo original no disponible",
    );
  });

  it("no inventa cambios realizados (nota/diffs ausentes)", () => {
    const out = aggregateCorreccionSolicitudHistorica([
      {
        expedienteId: "00000000-0000-4000-8000-0000000000e1",
        documentoId: "00000000-0000-4000-8000-0000000000d1",
        comentarioMesa: "Archivo incorrecto",
        actorId: null,
        createdAt: "2026-07-20T15:00:00.000Z",
      },
    ]);
    assert.equal(out.correctionRequestedNote, null);
    assert.equal(out.correctionRequestedByName, null);
  });

  it("hasAdvisorChangeDetails exige lote y count > 0", () => {
    assert.equal(
      hasAdvisorChangeDetails({
        advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
        advisorChangesCount: 2,
      }),
      true,
    );
    assert.equal(
      hasAdvisorChangeDetails({
        advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
        advisorChangesCount: 0,
      }),
      false,
    );
    assert.equal(
      hasAdvisorChangeDetails({
        advisorChangeBatchId: null,
        advisorChangesCount: 3,
      }),
      false,
    );
    assert.equal(
      esLoteAsesorCambiosVacio({
        advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
        advisorChangesCount: 0,
      }),
      true,
    );
    assert.equal(
      esLoteAsesorCambiosVacio({
        advisorChangeBatchId: null,
        advisorChangesCount: 0,
      }),
      false,
    );
    assert.match(MESA_ASESOR_CAMBIOS_LOTE_VACIO_AVISO, /sin cambios detectables/);
    assert.equal(
      MESA_ASESOR_CAMBIOS_LOTE_VACIO_TITULO,
      "Corrección enviada sin cambios detectables",
    );
  });

  it("lote vacío con batchId no es histórico P130.2", () => {
    assert.equal(
      esCorreccionHistoricaSinDetalle({
        resumenDocumental: "correccion_enviada",
        advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      }),
      false,
    );
  });

  it("badge con lote muestra conteo", () => {
    assert.equal(formatMesaAsesorCambiosBadge(2, true), "Cambios del asesor · 2");
    assert.equal(formatMesaAsesorCambiosBadge(0, true), "Cambios del asesor · 0");
  });

  it("resumen máximo 2 + +N", () => {
    assert.deepEqual(formatMesaAsesorCambiosResumen(["A"]), ["A"]);
    assert.deepEqual(formatMesaAsesorCambiosResumen(["A", "B"]), ["A", "B"]);
    assert.deepEqual(formatMesaAsesorCambiosResumen(["A", "B", "C", "D"]), [
      "A",
      "B",
      "+2 cambios",
    ]);
    assert.deepEqual(formatMesaAsesorCambiosResumen([]), []);
  });

  it("reenviado formatea America/Monterrey", () => {
    const s = formatMesaAsesorReenviadoAt("2026-07-23T22:30:00.000Z");
    assert.ok(s);
    assert.match(s!, /\d{2}\/\d{2}\/\d{4}/);
  });

  it("status labels canónicos", () => {
    assert.equal(
      formatMesaAsesorCambioStatusLabel("pendiente_revision"),
      "Pendiente de revisión",
    );
    assert.equal(formatMesaAsesorCambioStatusLabel("revisado"), "Revisado");
  });

  it("anchor allowlist docs → mesa-documentos-asesor", () => {
    assert.deepEqual(
      mesaAsesorCambioAnchor({
        campo: null,
        documentKind: "cliente_ine_frente",
        tipo: "documento_reemplazado",
        entidad: "documento",
      }),
      { sectionId: "mesa-documentos-asesor", fieldId: "cliente_ine_frente" },
    );
  });

  it("anchor campos cliente / notas / cobro", () => {
    assert.deepEqual(
      mesaAsesorCambioAnchor({
        campo: "rfc",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: "cliente_datos",
      }),
      { sectionId: "mesa-datos-generales", fieldId: "rfc" },
    );
    assert.deepEqual(
      mesaAsesorCambioAnchor({
        campo: "telefono",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: null,
      }),
      { sectionId: "mesa-datos-generales", fieldId: "telefono" },
    );
    assert.deepEqual(
      mesaAsesorCambioAnchor({
        campo: "notaMesa",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: null,
      }),
      { sectionId: "mesa-datos-generales", fieldId: "notaMesa" },
    );
    assert.deepEqual(
      mesaAsesorCambioAnchor({
        campo: "porcentaje_cobro",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: null,
      }),
      { sectionId: "mesa-datos-generales", fieldId: "porcentaje_cobro" },
    );
    assert.deepEqual(
      mesaAsesorCambioAnchor({
        campo: "montoMejoravit",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: null,
      }),
      {
        sectionId: "mesa-monto-mejoravit-actualizado",
        fieldId: "montoMejoravit",
      },
    );
  });

  it("agrupa Documentos / Cliente / Operativos / Notas", () => {
    assert.equal(
      groupMesaAsesorCambio({
        campo: null,
        documentKind: "cliente_estado_cuenta",
        tipo: "documento_reemplazado",
        entidad: null,
      }),
      "documentos",
    );
    assert.equal(
      groupMesaAsesorCambio({
        campo: "nombreCliente",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: null,
      }),
      "datos_cliente",
    );
    assert.equal(
      groupMesaAsesorCambio({
        campo: "metodo_pago",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: null,
      }),
      "datos_operativos",
    );
    assert.equal(
      groupMesaAsesorCambio({
        campo: "notaMesa",
        documentKind: null,
        tipo: "campo_actualizado",
        entidad: null,
      }),
      "notas",
    );
  });
});
