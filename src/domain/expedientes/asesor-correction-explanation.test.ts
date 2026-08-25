import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASESOR_CORRECCION_EXPLICACION_FALLBACK,
  formatAsesorCorreccionExplicacion,
  labelAsesorCorreccionDocumento,
  resolveAsesorCorreccionExplicacion,
} from "./asesor-correction-explanation";
import {
  formatCorreccionesPendientesCopy,
  listAsesorCorreccionesAbiertas,
} from "./asesor-pendientes";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";

describe("asesor-correction-explanation P209", () => {
  it("C1 DG → Datos generales", () => {
    assert.equal(
      formatAsesorCorreccionExplicacion(["Datos generales"]),
      "Mesa solicita corregir: Datos generales.",
    );
  });

  it("C2 INE frente", () => {
    assert.equal(
      formatAsesorCorreccionExplicacion(["INE frente"]),
      "Mesa solicita corregir: INE frente.",
    );
  });

  it("C3 otro document kind → label humano", () => {
    assert.equal(labelAsesorCorreccionDocumento("cliente_estado_cuenta"), "Estado de cuenta");
    assert.equal(
      formatAsesorCorreccionExplicacion([
        labelAsesorCorreccionDocumento("cliente_estado_cuenta"),
      ]),
      "Mesa solicita corregir: Estado de cuenta.",
    );
  });

  it("C4 dos elementos con nombres", () => {
    assert.equal(
      formatAsesorCorreccionExplicacion(["Datos generales", "INE frente"]),
      "Mesa solicita corregir 2 elementos: Datos generales e INE frente.",
    );
  });

  it("C5 tres elementos con nombres", () => {
    assert.equal(
      formatAsesorCorreccionExplicacion([
        "Datos generales",
        "INE frente",
        "Estado de cuenta",
      ]),
      "Mesa solicita corregir 3 elementos: Datos generales, INE frente y Estado de cuenta.",
    );
  });

  it("C6 estado correction_required + enrich count 0 → explanation NO vacía", () => {
    const copy = resolveAsesorCorreccionExplicacion({
      estadoEfectivo: "correccion_requerida",
      correccionExplicacion: "Mesa solicita corregir: Datos generales.",
    });
    assert.ok(copy);
    assert.notEqual(copy.trim(), "");
  });

  it("C7 enrich secundario falla → first paint sigue explicando vía RPC", () => {
    const copy = resolveAsesorCorreccionExplicacion({
      estadoEfectivo: "correccion_requerida",
      correccionExplicacion: "Mesa solicita corregir: INE frente.",
    });
    assert.equal(copy, "Mesa solicita corregir: INE frente.");
  });

  it("C8 R2 solo DG (labels explícitos)", () => {
    assert.equal(
      formatAsesorCorreccionExplicacion(["Datos generales"]),
      "Mesa solicita corregir: Datos generales.",
    );
  });

  it("C9 CORRECTION_PENDING_REVIEW → sin explicación de necesita corrección", () => {
    assert.equal(
      resolveAsesorCorreccionExplicacion({
        estadoEfectivo: "correccion_enviada",
        correccionExplicacion: null,
      }),
      null,
    );
  });

  it("C10 rechazado_mesa → no correction_required copy", () => {
    assert.equal(
      resolveAsesorCorreccionExplicacion({
        estadoEfectivo: "rechazado_mesa",
        correccionExplicacion: "Mesa solicita corregir: Datos generales.",
      }),
      null,
    );
  });

  it("C11 retención → explicación visible", () => {
    assert.equal(
      formatAsesorCorreccionExplicacion(["Retención"]),
      "Mesa solicita corregir: Retención.",
    );
  });

  it("C12 histórico no contamina cuando labels vienen del RPC", () => {
    assert.equal(
      resolveAsesorCorreccionExplicacion({
        estadoEfectivo: "correccion_requerida",
        correccionExplicacion: "Mesa solicita corregir: Datos generales.",
      }),
      "Mesa solicita corregir: Datos generales.",
    );
  });

  it("C13 fallback legacy → texto no vacío", () => {
    assert.equal(
      resolveAsesorCorreccionExplicacion({
        estadoEfectivo: "correccion_requerida",
        correccionExplicacion: null,
        labels: [],
      }),
      ASESOR_CORRECCION_EXPLICACION_FALLBACK,
    );
  });

  it("C14 inbox helper acepta labels locales para detalle", () => {
    const items = listAsesorCorreccionesAbiertas({
      clienteDatosEstado: "rechazado",
      archivos: [
        {
          id: "doc-1",
          expediente_id: "exp-1",
          tipo_documento: "cliente_estado_cuenta",
          estatus_revision: "rechazado",
          nombre_original: "ec.pdf",
          mime_type: "application/pdf",
          size_bytes: 100,
          created_at: "2026-01-01T00:00:00Z",
          uploaded_by_role: "asesor",
          uploaded_by_email: "a@test.local",
          comentario_mesa: null,
        } satisfies ExpedienteArchivoResumen,
      ],
    });
    assert.equal(
      formatCorreccionesPendientesCopy(items.length, items.map((i) => i.label)),
      "Mesa solicita corregir 2 elementos: Datos generales e Estado de cuenta.",
    );
  });

  it("C18 «1 elemento» sustituido por label específico", () => {
    assert.equal(
      formatCorreccionesPendientesCopy(1, ["Estado de cuenta"]),
      "Mesa solicita corregir: Estado de cuenta.",
    );
    assert.doesNotMatch(
      formatCorreccionesPendientesCopy(1, ["Estado de cuenta"]),
      /1 elemento/,
    );
  });

  it("C16/C17 todas las labels non-empty tras trim", () => {
    for (const labels of [
      ["Datos generales"],
      ["INE frente"],
      ["Datos generales", "INE frente"],
    ]) {
      const copy = formatAsesorCorreccionExplicacion(labels);
      assert.ok(copy);
      assert.notEqual(copy.trim(), "");
    }
  });
});
