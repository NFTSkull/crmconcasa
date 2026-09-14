import assert from "node:assert/strict";
import test from "node:test";
import { mapAdminExpedienteOverviewRow } from "./admin-expedientes-overview";

test("mapea enviado a Mesa y conteos documentales sin perder NSS", () => {
  const row = mapAdminExpedienteOverviewRow({
    expediente_id: "exp-1",
    cliente_nombre: "CLIENTE PRUEBA",
    nss: "01234567890",
    asesor_id: "asesor-1",
    asesor_nombre: "Asesor",
    asesor_email: "asesor@example.com",
    programa: "mejoravit",
    etapa_actual: 1,
    subestado: "pendiente",
    ciclo_estado: "activo",
    enviado_a_mesa: true,
    fecha_envio_mesa: "2026-09-14T20:00:00Z",
    documentos_activos_count: 4,
    documentos_total_count: 6,
    ultimo_documento_at: "2026-09-14T19:00:00Z",
  });

  assert.equal(row.expedienteId, "exp-1");
  assert.equal(row.nss, "01234567890");
  assert.equal(row.enviadoAMesa, true);
  assert.equal(row.documentosActivosCount, 4);
  assert.equal(row.documentosTotalCount, 6);
});

test("mapea no enviado con cero documentos", () => {
  const row = mapAdminExpedienteOverviewRow({
    expediente_id: "exp-2",
    cliente_nombre: "PRE MESA",
    nss: "00000000001",
    enviado_a_mesa: false,
    documentos_activos_count: 0,
    documentos_total_count: 0,
  });

  assert.equal(row.enviadoAMesa, false);
  assert.equal(row.fechaEnvioMesa, null);
  assert.equal(row.documentosActivosCount, 0);
  assert.equal(row.documentosTotalCount, 0);
});
