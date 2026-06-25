import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "@/domain/expediente-archivos/integration-docs-completos";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import {
  deriveBloqueosContinuarIntegracion,
  puedeContinuarIntegracion,
  puedeMostrarContinuarIntegracion,
  type MesaContinuarIntegracionContext,
} from "./mesa-avance-integracion";

function row(
  tipo: (typeof INTEGRATION_DOC_TIPOS_VALIDACION_MESA)[number],
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `doc-${tipo}`,
    nombre_original: `${tipo}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 100,
    created_at: "2026-06-25T00:00:00.000Z",
    uploaded_by_role: "asesor",
    uploaded_by_email: null,
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

function resumenTodosValidados(): ExpedienteArchivoResumen[] {
  return INTEGRATION_DOC_TIPOS_VALIDACION_MESA.map((tipo) => row(tipo, "validado"));
}

function baseCtx(
  overrides: Partial<MesaContinuarIntegracionContext> = {},
): MesaContinuarIntegracionContext {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 1,
    subestado: "en_validacion_mesa",
    clienteDatosEstado: "validado",
    archivosResumen: resumenTodosValidados(),
    ...overrides,
  };
}

describe("puedeMostrarContinuarIntegracion", () => {
  it("visible en etapa 1 / en_validacion_mesa con envío a Mesa", () => {
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx()), true);
  });

  it("no visible si etapa_actual >= 2", () => {
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx({ etapaActual: 2 })), false);
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx({ etapaActual: 3 })), false);
  });

  it("no visible sin submitted_to_mesa", () => {
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx({ submittedToMesa: false })), false);
  });

  it("no visible si subestado distinto de en_validacion_mesa", () => {
    assert.equal(
      puedeMostrarContinuarIntegracion(baseCtx({ subestado: "en_proceso" })),
      false,
    );
  });
});

describe("deriveBloqueosContinuarIntegracion", () => {
  it("bloqueado si datos no están validados", () => {
    const bloqueos = deriveBloqueosContinuarIntegracion(
      baseCtx({ clienteDatosEstado: "completo" }),
    );
    assert.ok(bloqueos.some((b) => /datos generales/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ clienteDatosEstado: "completo" })), false);
  });

  it("bloqueado si falta acta de nacimiento", () => {
    const archivos = resumenTodosValidados().filter(
      (a) => a.tipo_documento !== "cliente_acta_nacimiento",
    );
    const bloqueos = deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos }));
    assert.ok(bloqueos.some((b) => /acta de nacimiento/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), false);
  });

  it("bloqueado si falta constancia SAT", () => {
    const archivos = resumenTodosValidados().filter(
      (a) => a.tipo_documento !== "cliente_constancia_sat",
    );
    const bloqueos = deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos }));
    assert.ok(bloqueos.some((b) => /constancia sat/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), false);
  });

  it("bloqueado si hay documento resubido sin validar", () => {
    const archivos = resumenTodosValidados().map((a) =>
      a.tipo_documento === "nss" ? row("nss", "resubido") : a,
    );
    const bloqueos = deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos }));
    assert.ok(bloqueos.some((b) => /resubido/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), false);
  });

  it("habilitado si datos + 7 docs están validados", () => {
    assert.deepEqual(deriveBloqueosContinuarIntegracion(baseCtx()), []);
    assert.equal(puedeContinuarIntegracion(baseCtx()), true);
  });

  it("semanas cotizadas opcional no bloquea", () => {
    assert.equal(puedeContinuarIntegracion(baseCtx()), true);
  });
});
