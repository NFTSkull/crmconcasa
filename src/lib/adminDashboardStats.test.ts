import test from "node:test";
import assert from "node:assert/strict";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";
import {
  computeAdminFunnelByEtapa,
  computeAdminFunnelExclusive,
  computeAdminMetricsByAsesor,
  computeAdminOperativoKpis,
  computeAdminTimeMetrics,
} from "@/lib/adminDashboardStats";

function exp(
  p: Partial<Omit<ExpedienteMock, "base">> & {
    id: string;
    base?: Partial<ExpedienteMock["base"]>;
  },
): ExpedienteMock {
  const base: ExpedienteMock["base"] = {
    programa: "P",
    nss: "1",
    cliente_nombre: "C",
    telefono_cliente: "1",
    direccion_opcional: "",
    asesorId: "a@test",
    createdAt: "2026-01-01T00:00:00.000Z",
    origenMesa: null,
    ...p.base,
  };
  const editorDecision: ExpedienteMock["editorDecision"] = {
    decision: "pendiente",
    monto_aprobado: null,
    notas_revision: "",
    ...p.editorDecision,
  };
  const operativo: ExpedienteMock["operativo"] = {
    etapaActual: null,
    subestado: "pendiente",
    motivoRechazo: null,
    comentarioRechazo: null,
    fechaCita: null,
    updatedAt: null,
    submittedToMesa: false,
    fechaEnvioMesa: null,
    cicloEstado: null,
    ...p.operativo,
  };
  return { id: p.id, base, editorDecision, operativo };
}

function op(
  x: Partial<ExpedienteMock["operativo"]>,
): ExpedienteMock["operativo"] {
  return {
    etapaActual: null,
    subestado: "pendiente",
    motivoRechazo: null,
    comentarioRechazo: null,
    fechaCita: null,
    updatedAt: null,
    submittedToMesa: false,
    fechaEnvioMesa: null,
    cicloEstado: null,
    ...x,
  };
}

function ed(
  x: Partial<ExpedienteMock["editorDecision"]>,
): ExpedienteMock["editorDecision"] {
  return {
    decision: "pendiente",
    monto_aprobado: null,
    notas_revision: "",
    ...x,
  };
}

test("computeAdminOperativoKpis: firmados etapa >= 11", () => {
  const list = [
    exp({
      id: "1",
      operativo: op({ etapaActual: 11, submittedToMesa: true, subestado: "en_proceso" }),
    }),
    exp({
      id: "2",
      operativo: op({ etapaActual: 12, submittedToMesa: true, subestado: "en_proceso" }),
    }),
    exp({
      id: "3",
      operativo: op({ etapaActual: 10, submittedToMesa: true, subestado: "en_proceso" }),
    }),
  ];
  const k = computeAdminOperativoKpis(list);
  assert.equal(k.total, 3);
  assert.equal(k.firmados, 2);
});

test("computeAdminOperativoKpis: rechazados operativo vs editor", () => {
  const list = [
    exp({
      id: "1",
      operativo: op({ subestado: "rechazado", submittedToMesa: true, etapaActual: 2 }),
      editorDecision: ed({ decision: "aprobado" }),
    }),
    exp({
      id: "2",
      operativo: op({ subestado: "en_proceso", submittedToMesa: false, etapaActual: 1 }),
      editorDecision: ed({ decision: "no_cumple" }),
    }),
  ];
  const k = computeAdminOperativoKpis(list);
  assert.equal(k.rechazadosOperativo, 1);
  assert.equal(k.rechazadosEditor, 1);
});

test("computeAdminFunnelExclusive: prioridad finalizado > firma", () => {
  const list = [
    exp({
      id: "1",
      operativo: op({ etapaActual: 10, submittedToMesa: true, subestado: "en_proceso" }),
    }),
    exp({
      id: "2",
      operativo: op({ etapaActual: 11, submittedToMesa: true, subestado: "en_proceso" }),
    }),
  ];
  const f = computeAdminFunnelExclusive(list);
  assert.equal(f.firma, 1);
  assert.equal(f.finalizado, 1);
  assert.equal(f.precal + f.mesa + f.biometricos + f.tramite + f.otros, 0);
});

test("computeAdminMetricsByAsesor: agrega y conversión firmados/enviados mesa", () => {
  const list = [
    exp({
      id: "a",
      base: { asesorId: "x@test" },
      operativo: op({ submittedToMesa: true, etapaActual: 11, subestado: "en_proceso" }),
    }),
    exp({
      id: "b",
      base: { asesorId: "x@test" },
      operativo: op({ submittedToMesa: true, etapaActual: 4, subestado: "en_proceso" }),
    }),
    exp({
      id: "c",
      base: { asesorId: "y@test" },
      operativo: op({ submittedToMesa: false, etapaActual: 1, subestado: "pendiente" }),
    }),
    exp({
      id: "d",
      base: { asesorId: "y@test" },
      operativo: op({ submittedToMesa: false, etapaActual: 11, subestado: "en_proceso" }),
    }),
  ];
  const rows = computeAdminMetricsByAsesor(list);
  const rx = rows.find((r) => r.asesorId === "x@test");
  const ry = rows.find((r) => r.asesorId === "y@test");
  assert.ok(rx);
  assert.equal(rx.totalExpedientes, 2);
  assert.equal(rx.enviadosMesa, 2);
  assert.equal(rx.firmados, 1);
  assert.equal(rx.enBiometricos, 1);
  assert.equal(rx.conversionFirmadosSobreEnviadosMesa, 0.5);
  assert.ok(ry);
  assert.equal(ry.totalExpedientes, 2);
  assert.equal(ry.enviadosMesa, 0);
  assert.equal(ry.firmados, 1);
  assert.equal(ry.conversionFirmadosSobreEnviadosMesa, null);
});

test("computeAdminFunnelByEtapa", () => {
  const list = [
    exp({ id: "1", operativo: op({ etapaActual: 3, submittedToMesa: true }) }),
    exp({ id: "2", operativo: op({ etapaActual: 3, submittedToMesa: true }) }),
    exp({ id: "3", operativo: op({ etapaActual: null, submittedToMesa: false }) }),
  ];
  const h = computeAdminFunnelByEtapa(list);
  assert.equal(h.byEtapa[3], 2);
  assert.equal(h.sinEtapa, 1);
});

test("computeAdminTimeMetrics: vacío", () => {
  const m = computeAdminTimeMetrics([]);
  assert.equal(m.tiempoTotalPromedioFirmados, null);
  assert.equal(m.antiguedadPorEtapa.length, 0);
  assert.equal(m.cuelloDeBotella, null);
  assert.equal(m.top10MasLentos.length, 0);
});

test("computeAdminTimeMetrics: promedio firmados, cuello y top", () => {
  const day = (d: number) =>
    `2026-01-${String(d).padStart(2, "0")}T12:00:00.000Z`;
  const list = [
    exp({
      id: "f1",
      base: { createdAt: day(1) },
      operativo: op({
        etapaActual: 11,
        submittedToMesa: true,
        updatedAt: day(11),
      }),
    }),
    exp({
      id: "f2",
      base: { createdAt: day(1) },
      operativo: op({
        etapaActual: 11,
        submittedToMesa: true,
        updatedAt: day(21),
      }),
    }),
    exp({
      id: "e2a",
      base: { createdAt: day(1) },
      operativo: op({ etapaActual: 2, submittedToMesa: true, updatedAt: day(10) }),
    }),
    exp({
      id: "e2b",
      base: { createdAt: day(1) },
      operativo: op({ etapaActual: 2, submittedToMesa: true, updatedAt: day(10) }),
    }),
    exp({
      id: "e2c",
      base: { createdAt: day(1) },
      operativo: op({ etapaActual: 2, submittedToMesa: true, updatedAt: day(10) }),
    }),
    exp({
      id: "e3a",
      base: { createdAt: day(1) },
      operativo: op({ etapaActual: 3, submittedToMesa: true, updatedAt: day(4) }),
    }),
    exp({
      id: "e3b",
      base: { createdAt: day(1) },
      operativo: op({ etapaActual: 3, submittedToMesa: true, updatedAt: day(4) }),
    }),
  ];
  const m = computeAdminTimeMetrics(list);
  assert.ok(m.tiempoTotalPromedioFirmados);
  assert.equal(m.tiempoTotalPromedioFirmados!.sampleSize, 2);
  assert.ok(Math.abs(m.tiempoTotalPromedioFirmados!.meanDays - 15) < 0.001);

  const row2 = m.antiguedadPorEtapa.find((r) => r.etapa === 2);
  assert.ok(row2);
  assert.equal(row2!.sampleSize, 3);
  assert.ok(Math.abs(row2!.meanDays - 9) < 0.001);

  assert.ok(m.cuelloDeBotella);
  assert.equal(m.cuelloDeBotella!.etapa, 2);
  assert.ok(Math.abs(m.cuelloDeBotella!.meanDays - 9) < 0.001);

  assert.equal(m.top10MasLentos[0]?.id, "f2");
  assert.equal(m.top10MasLentos[1]?.id, "f1");
});

test("computeAdminTimeMetrics: sin cuello si muestra < 3", () => {
  const list = [
    exp({
      id: "a",
      base: { createdAt: "2026-01-01T00:00:00.000Z" },
      operativo: op({
        etapaActual: 2,
        submittedToMesa: false,
        updatedAt: "2026-01-20T00:00:00.000Z",
      }),
    }),
    exp({
      id: "b",
      base: { createdAt: "2026-01-01T00:00:00.000Z" },
      operativo: op({
        etapaActual: 2,
        submittedToMesa: false,
        updatedAt: "2026-01-20T00:00:00.000Z",
      }),
    }),
  ];
  const m = computeAdminTimeMetrics(list);
  assert.equal(m.cuelloDeBotella, null);
});

test("computeAdminTimeMetrics: excluye intervalo inválido o sin updatedAt", () => {
  const list = [
    exp({
      id: "bad",
      base: { createdAt: "2026-01-10T00:00:00.000Z" },
      operativo: op({
        etapaActual: 11,
        submittedToMesa: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    }),
    exp({
      id: "noupd",
      base: { createdAt: "2026-01-01T00:00:00.000Z" },
      operativo: op({ etapaActual: 11, submittedToMesa: true, updatedAt: null }),
    }),
  ];
  const m = computeAdminTimeMetrics(list);
  assert.equal(m.tiempoTotalPromedioFirmados, null);
  assert.equal(m.top10MasLentos.length, 0);
});
