import test from "node:test";
import assert from "node:assert/strict";
import {
  mapCreateExpedienteRpcToExpedienteMock,
  mapProgramaDbToUi,
  mapSupabaseRowToExpedienteMock,
} from "@/domain/expedientes/map-supabase-row";

const BASE_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  programa: "mejoravit",
  nss: "12345678901",
  cliente_nombre: "Ana Test",
  telefono_cliente: "5512345678",
  direccion_opcional: "",
  asesor_id: "22222222-2222-2222-2222-222222222222",
  origen_mesa: "interno",
  submitted_to_mesa: true,
  etapa_actual: 3,
  subestado: "en_proceso",
  created_at: "2026-06-01T12:00:00.000Z",
  updated_at: "2026-06-02T15:30:00.000Z",
} as const;

test("mapProgramaDbToUi: casing DB → UI", () => {
  assert.equal(mapProgramaDbToUi("mejoravit"), "Mejoravit");
  assert.equal(mapProgramaDbToUi("subcuenta"), "Subcuenta");
  assert.equal(mapProgramaDbToUi("compro_tu_casa"), "Compro tu casa");
});

test("mapSupabaseRowToExpedienteMock: fila completa con asesor y decisión", () => {
  const mock = mapSupabaseRowToExpedienteMock({
    ...BASE_ROW,
    editor_decisions: {
      decision: "aprobado",
      monto_aprobado: "150000.50",
      notas_revision: "OK",
    },
    asesor: { email: "asesor@concasa.mx", full_name: "Asesor Uno" },
    fecha_cita: null,
  });

  assert.equal(mock.base.programa, "Mejoravit");
  assert.equal(mock.base.asesorId, "asesor@concasa.mx");
  assert.equal(mock.editorDecision.decision, "aprobado");
  assert.equal(mock.editorDecision.monto_aprobado, 150000.5);
  assert.equal(mock.operativo.etapaActual, 3);
  assert.equal(mock.operativo.subestado, "en_proceso");
  assert.equal(mock.operativo.submittedToMesa, true);
  assert.equal(mock.operativo.fechaCita, null);
});

test("mapSupabaseRowToExpedienteMock: sin editor_decisions ni asesor embed", () => {
  const mock = mapSupabaseRowToExpedienteMock({
    ...BASE_ROW,
    submitted_to_mesa: false,
    editor_decisions: null,
    asesor: null,
  });

  assert.equal(mock.editorDecision.decision, "pendiente");
  assert.equal(mock.editorDecision.monto_aprobado, null);
  assert.equal(mock.base.asesorId, BASE_ROW.asesor_id);
  assert.equal(mock.operativo.submittedToMesa, false);
});

test("mapSupabaseRowToExpedienteMock: editor_decisions como array", () => {
  const mock = mapSupabaseRowToExpedienteMock({
    ...BASE_ROW,
    editor_decisions: [{ decision: "no_cumple", monto_aprobado: null, notas_revision: "x" }],
  });
  assert.equal(mock.editorDecision.decision, "no_cumple");
});

test("mapSupabaseRowToExpedienteMock: en_validacion_mesa conserva etapa 1", () => {
  const mock = mapSupabaseRowToExpedienteMock({
    ...BASE_ROW,
    etapa_actual: 1,
    subestado: "en_validacion_mesa",
  });
  assert.equal(mock.operativo.etapaActual, 1);
  assert.equal(mock.operativo.subestado, "en_validacion_mesa");
});

test("mapCreateExpedienteRpcToExpedienteMock: respuesta RPC create", () => {
  const mock = mapCreateExpedienteRpcToExpedienteMock(
    {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      programa: "mejoravit",
      nss: "88000000001",
      cliente_nombre: "Nuevo Cliente",
      telefono_cliente: "5512345678",
      direccion_opcional: "Calle 1",
      origen_mesa: "interno",
      etapa_actual: 1,
      subestado: "pendiente",
      submitted_to_mesa: false,
      created_at: "2026-06-15T10:00:00.000Z",
    },
    "asesor@concasa.mx",
  );

  assert.equal(mock.id, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(mock.base.programa, "Mejoravit");
  assert.equal(mock.base.asesorId, "asesor@concasa.mx");
  assert.equal(mock.editorDecision.decision, "pendiente");
  assert.equal(mock.operativo.etapaActual, 1);
  assert.equal(mock.operativo.subestado, "pendiente");
  assert.equal(mock.operativo.submittedToMesa, false);
  assert.equal(mock.base.origenMesa, "interno");
});
