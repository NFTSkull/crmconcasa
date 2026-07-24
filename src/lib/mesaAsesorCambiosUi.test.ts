import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMesaAsesorCambiosBadge,
  formatMesaAsesorCambiosResumen,
  formatMesaAsesorCambioStatusLabel,
  formatMesaAsesorReenviadoAt,
  groupMesaAsesorCambio,
  mesaAsesorCambioAnchor,
} from "./mesaAsesorCambiosUi";

describe("mesaAsesorCambiosUi", () => {
  it("badge sin lote → histórico", () => {
    assert.equal(
      formatMesaAsesorCambiosBadge(3, false),
      "Sin detalle histórico de cambios",
    );
    assert.equal(
      formatMesaAsesorCambiosBadge(null, false),
      "Sin detalle histórico de cambios",
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
