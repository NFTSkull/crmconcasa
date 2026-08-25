import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import {
  esDisponibleParaMesa,
  filterMesaOpsItems,
  getMesaOpsStatusLabel,
  mesaEsTrabajoAccionableMesa,
  mergeExpedientesWithMesaOps,
  buildMesaOpsMap,
} from "@/lib/mesaOpsUi";

const USER_A = "00000000-0000-4000-8206-000000000001";
const USER_B = "00000000-0000-4000-8206-000000000002";

function ops(
  partial: Partial<MesaExpedienteOpsRow> & { expedienteId: string },
): MesaExpedienteOpsRow {
  return {
    estadoMesa: "sin_asignar",
    assignedTo: null,
    assignedAt: null,
    lastActivityAt: null,
    assignedToName: null,
    ...partial,
  };
}

function item(partial: {
  id: string;
  cicloEstado?: string;
  subestado?: string;
  resumenDocumental?: CategoriaResumenDocumental | null;
  cambioRevisionEstado?: string | null;
  etapaActual?: number;
}) {
  return {
    id: partial.id,
    fechaEnvioMesa: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T09:00:00.000Z",
    cicloEstado: partial.cicloEstado ?? "activo",
    subestado: partial.subestado ?? "en_proceso",
    resumenDocumental: partial.resumenDocumental ?? null,
    cambioRevisionEstado: partial.cambioRevisionEstado ?? null,
    etapaActual: partial.etapaActual ?? 2,
  };
}

describe("P206 Disponibles = todo trabajo accionable", () => {
  it("D1: normal accionable sin asignar → Disponible", () => {
    const merged = mergeExpedientesWithMesaOps(
      [item({ id: "e1" })],
      buildMesaOpsMap([]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), true);
  });

  it("D2: normal accionable assigned current → Disponible", () => {
    const merged = mergeExpedientesWithMesaOps(
      [item({ id: "e1" })],
      buildMesaOpsMap([
        ops({
          expedienteId: "e1",
          estadoMesa: "trabajando",
          assignedTo: USER_A,
          assignedAt: "x",
        }),
      ]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), true);
    assert.equal(
      getMesaOpsStatusLabel(
        ops({
          expedienteId: "e1",
          estadoMesa: "trabajando",
          assignedTo: USER_A,
          assignedAt: "x",
        }),
        USER_A,
      ),
      "Trabajando por ti",
    );
  });

  it("D3: normal accionable assigned otro → Disponible + badge", () => {
    const merged = mergeExpedientesWithMesaOps(
      [item({ id: "e1" })],
      buildMesaOpsMap([
        ops({
          expedienteId: "e1",
          estadoMesa: "trabajando",
          assignedTo: USER_B,
          assignedAt: "x",
        }),
      ]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), true);
    assert.equal(
      getMesaOpsStatusLabel(
        ops({
          expedienteId: "e1",
          estadoMesa: "trabajando",
          assignedTo: USER_B,
          assignedAt: "x",
        }),
        USER_A,
      ),
      "Trabajando por otro usuario",
    );
  });

  it("D4–D6: CORRECTION_PENDING_REVIEW siempre Disponible", () => {
    for (const assignedTo of [null, USER_A, USER_B]) {
      const merged = mergeExpedientesWithMesaOps(
        [
          item({
            id: "e1",
            subestado: "rechazado",
            cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
          }),
        ],
        buildMesaOpsMap(
          assignedTo
            ? [
                ops({
                  expedienteId: "e1",
                  estadoMesa: "trabajando",
                  assignedTo,
                  assignedAt: "x",
                }),
              ]
            : [],
        ),
      );
      assert.equal(esDisponibleParaMesa(merged[0]!), true, String(assignedTo));
    }
  });

  it("P199 D7–D8: ADVISOR_UPDATE sigue accionable; P207 Disponibles NO", () => {
    for (const assignedTo of [null, USER_B]) {
      const merged = mergeExpedientesWithMesaOps(
        [
          item({
            id: "e1",
            etapaActual: 9,
            cambioRevisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
          }),
        ],
        buildMesaOpsMap(
          assignedTo
            ? [
                ops({
                  expedienteId: "e1",
                  estadoMesa: "trabajando",
                  assignedTo,
                  assignedAt: "x",
                }),
              ]
            : [],
        ),
      );
      assert.equal(
        mesaEsTrabajoAccionableMesa({
          cicloEstado: "activo",
          cambioRevisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
        }),
        true,
      );
      assert.equal(esDisponibleParaMesa(merged[0]!), false);
    }
  });

  it("D9–D10: WAITING_ADVISOR nunca Disponible", () => {
    for (const assignedTo of [null, USER_A]) {
      const merged = mergeExpedientesWithMesaOps(
        [item({ id: "e1", cambioRevisionEstado: "WAITING_ADVISOR" })],
        buildMesaOpsMap(
          assignedTo
            ? [
                ops({
                  expedienteId: "e1",
                  estadoMesa: "trabajando",
                  assignedTo,
                  assignedAt: "x",
                }),
              ]
            : [],
        ),
      );
      assert.equal(esDisponibleParaMesa(merged[0]!), false);
    }
  });

  it("D11: correccion_requerida sin respuesta → NO", () => {
    const merged = mergeExpedientesWithMesaOps(
      [item({ id: "e1", resumenDocumental: "correccion_requerida" })],
      buildMesaOpsMap([]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), false);
  });

  it("D12: raw rechazado sin pending → NO", () => {
    const merged = mergeExpedientesWithMesaOps(
      [item({ id: "e1", subestado: "rechazado" })],
      buildMesaOpsMap([]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), false);
  });

  it("D13: raw rechazado + CORRECTION_PENDING_REVIEW → SI", () => {
    const merged = mergeExpedientesWithMesaOps(
      [
        item({
          id: "e1",
          subestado: "rechazado",
          cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
        }),
      ],
      buildMesaOpsMap([]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), true);
  });

  it("D14: cancelado → NO", () => {
    const merged = mergeExpedientesWithMesaOps(
      [item({ id: "e1", cicloEstado: "cancelado" })],
      buildMesaOpsMap([]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), false);
  });

  it("D17–D20: otros filtros intactos", () => {
    const merged = mergeExpedientesWithMesaOps(
      [
        item({ id: "mine" }),
        item({ id: "other" }),
        item({
          id: "waiting",
          resumenDocumental: "correccion_requerida",
        }),
      ],
      buildMesaOpsMap([
        ops({
          expedienteId: "mine",
          estadoMesa: "trabajando",
          assignedTo: USER_A,
          assignedAt: "x",
        }),
        ops({
          expedienteId: "other",
          estadoMesa: "trabajando",
          assignedTo: USER_B,
          assignedAt: "x",
        }),
      ]),
    );
    assert.deepEqual(
      filterMesaOpsItems(merged, "mi_bandeja", USER_A).map((i) => i.id),
      ["mine"],
    );
    assert.deepEqual(
      filterMesaOpsItems(merged, "en_trabajo", USER_A)
        .map((i) => i.id)
        .sort(),
      ["mine", "other"],
    );
    assert.deepEqual(
      filterMesaOpsItems(merged, "en_espera_asesor", USER_A).map((i) => i.id),
      ["waiting"],
    );
    assert.equal(filterMesaOpsItems(merged, "todo_mesa", USER_A).length, 3);
  });

  it("D23: helper P199 TS coincide con reglas de membresía", () => {
    assert.equal(
      mesaEsTrabajoAccionableMesa({
        cicloEstado: "activo",
        subestado: "rechazado",
        cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
      }),
      true,
    );
    assert.equal(
      mesaEsTrabajoAccionableMesa({
        cicloEstado: "activo",
        subestado: "en_proceso",
        cambioRevisionEstado: "WAITING_ADVISOR",
      }),
      false,
    );
  });
});
