import test from "node:test";
import assert from "node:assert/strict";

import {
  MONTO_MAXIMO_APORTACION_MEJORAVIT_ADMIN,
  aportacionMontoAprobadoMejoravitAdmin,
} from "./monto-aportacion-admin";
import {
  computeAdminProductionSummary,
  computePrecalMontosMejoravit,
  formatPrecalMontoAlAprobarDisplay,
  MONTO_SNAPSHOT_NO_RECUPERABLE_LABEL,
  type AdminPrecalEvent,
} from "./metrics";
import { resolveAdminPeriodBounds } from "./period";

test("aportacionMontoAprobadoMejoravitAdmin — vectores unitarios", () => {
  assert.equal(MONTO_MAXIMO_APORTACION_MEJORAVIT_ADMIN, 169_000);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(0), 0);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(50_000), 50_000);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(168_999.99), 168_999.99);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(169_000), 169_000);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(169_000.01), 169_000);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(200_000), 169_000);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(300_000), 169_000);
  assert.equal(aportacionMontoAprobadoMejoravitAdmin(1_000_000), 169_000);
});

function precal(
  partial: Partial<AdminPrecalEvent> & {
    expedienteId: string;
    montoAprobadoAlAprobar: number | null;
  },
): AdminPrecalEvent {
  return {
    expedienteId: partial.expedienteId,
    fecha: partial.fecha ?? "2026-07-10T18:00:00.000Z",
    aprobadoAt: partial.aprobadoAt ?? "2026-07-10T18:00:00.000Z",
    noCumpleAt: partial.noCumpleAt ?? null,
    clienteNombre: partial.clienteNombre ?? "Cliente",
    asesorId: partial.asesorId ?? "asesor-1",
    asesorNombre: partial.asesorNombre ?? "Asesor",
    asesorEmail: partial.asesorEmail ?? "a@x.com",
    decision: partial.decision ?? "aprobado",
    montoAprobadoAlAprobar: partial.montoAprobadoAlAprobar,
    montoAprobadoActual: partial.montoAprobadoActual ?? partial.montoAprobadoAlAprobar,
    montoSnapshotNoRecuperable: partial.montoSnapshotNoRecuperable,
    programa: partial.programa ?? "mejoravit",
  };
}

test("agregados mock — totales con tope por expediente", () => {
  const cases: Array<{ montos: number[]; total: number }> = [
    { montos: [50_000, 100_000], total: 150_000 },
    { montos: [169_000, 169_000], total: 338_000 },
    { montos: [200_000, 100_000], total: 269_000 },
    { montos: [200_000, 300_000], total: 338_000 },
    { montos: [50_000, 200_000, 300_000], total: 388_000 },
  ];

  for (const c of cases) {
    const rows = c.montos.map((m, i) =>
      precal({ expedienteId: `e-${i}`, montoAprobadoAlAprobar: m }),
    );
    const montos = computePrecalMontosMejoravit(rows);
    assert.equal(montos.montoAprobadoTotal, c.total, `total de ${c.montos.join(",")}`);
  }
});

test("promedios mock — misma base limitada", () => {
  const a = computePrecalMontosMejoravit([
    precal({ expedienteId: "a", montoAprobadoAlAprobar: 200_000 }),
    precal({ expedienteId: "b", montoAprobadoAlAprobar: 100_000 }),
  ]);
  assert.equal(a.montoAprobadoTotal, 269_000);
  assert.equal(a.montoPromedioAprobado, 134_500);

  const b = computePrecalMontosMejoravit([
    precal({ expedienteId: "a", montoAprobadoAlAprobar: 200_000 }),
    precal({ expedienteId: "b", montoAprobadoAlAprobar: 300_000 }),
  ]);
  assert.equal(b.montoAprobadoTotal, 338_000);
  assert.equal(b.montoPromedioAprobado, 169_000);
});

test("filas originales conservan snapshot real > 169000", () => {
  const row = precal({
    expedienteId: "snap",
    montoAprobadoAlAprobar: 250_000,
    montoAprobadoActual: 250_000,
  });
  const rows = [row];
  const montos = computePrecalMontosMejoravit(rows);
  assert.equal(montos.montoAprobadoTotal, 169_000);
  assert.equal(rows[0]!.montoAprobadoAlAprobar, 250_000);
  assert.equal(row.montoAprobadoAlAprobar, 250_000);
});

test("caso Walter — snapshot 256121.69 aporta 169000; fila intacta", () => {
  const row = precal({
    expedienteId: "walter",
    montoAprobadoAlAprobar: 256_121.69,
    montoAprobadoActual: 256_121.69,
    montoSnapshotNoRecuperable: false,
  });
  const montos = computePrecalMontosMejoravit([row]);
  assert.equal(montos.montoAprobadoTotal, 169_000);
  assert.equal(montos.montoPromedioAprobado, 169_000);
  assert.equal(row.montoAprobadoAlAprobar, 256_121.69);
  assert.equal(row.montoSnapshotNoRecuperable, false);
});

test("snapshot no recuperable — semántica P084 en display; no aporta a agregados", () => {
  const row = precal({
    expedienteId: "nr",
    montoAprobadoAlAprobar: null,
    montoAprobadoActual: null,
    montoSnapshotNoRecuperable: true,
  });
  assert.equal(
    formatPrecalMontoAlAprobarDisplay(row, (n) => String(n)),
    MONTO_SNAPSHOT_NO_RECUPERABLE_LABEL,
  );
  const montos = computePrecalMontosMejoravit([row]);
  assert.equal(montos.montoAprobadoTotal, 0);
  assert.equal(montos.montoPromedioAprobado, 0);
});

test("computeAdminProductionSummary aplica el mismo tope por expediente", () => {
  const bounds = resolveAdminPeriodBounds({
    preset: "personalizado",
    customFrom: "2026-07-10",
    customToInclusive: "2026-07-10",
  });
  const summary = computeAdminProductionSummary({
    bounds,
    mesaEnvios: [],
    precalRows: [
      precal({
        expedienteId: "a",
        montoAprobadoAlAprobar: 200_000,
        aprobadoAt: "2026-07-10T18:00:00.000Z",
      }),
      precal({
        expedienteId: "b",
        montoAprobadoAlAprobar: 100_000,
        aprobadoAt: "2026-07-10T19:00:00.000Z",
      }),
      precal({
        expedienteId: "c",
        montoAprobadoAlAprobar: 300_000,
        programa: "subcuenta",
        aprobadoAt: "2026-07-10T20:00:00.000Z",
      }),
    ],
  });
  assert.equal(summary.precalificacionesAprobadas, 3);
  assert.equal(summary.montoAprobadoTotal, 269_000);
  assert.equal(summary.aprobadasMayorA20000, 3);
});

test("programa no Mejoravit no aporta al indicador de monto", () => {
  const montos = computePrecalMontosMejoravit([
    precal({
      expedienteId: "t",
      montoAprobadoAlAprobar: 500_000,
      programa: "subcuenta",
    }),
  ]);
  assert.equal(montos.montoAprobadoTotal, 0);
  assert.equal(montos.montoPromedioAprobado, 0);
});
