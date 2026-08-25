import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import {
  esDisponibleParaMesa,
  filterMesaOpsItems,
  mesaEsTrabajoAccionableMesa,
  mergeExpedientesWithMesaOps,
  buildMesaOpsMap,
} from "@/lib/mesaOpsUi";
import { esNuevoEtapa12 } from "@/lib/mesaBandejaFiltros";

const USER_A = "00000000-0000-4000-8207-000000000001";
const USER_B = "00000000-0000-4000-8207-000000000002";

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
    etapaActual: partial.etapaActual ?? 1,
  };
}

function disp(p: Parameters<typeof item>[0]): boolean {
  const merged = mergeExpedientesWithMesaOps([item(p)], buildMesaOpsMap([]));
  return esDisponibleParaMesa(merged[0]!);
}

describe("P207 Disponibles = nuevos ∪ CORRECTION_PENDING_REVIEW", () => {
  it("T1 etapa1 pendiente → Disponible", () => {
    assert.equal(disp({ id: "t1", etapaActual: 1, subestado: "pendiente" }), true);
  });
  it("T2 etapa1 en_validacion → Disponible", () => {
    assert.equal(
      disp({ id: "t2", etapaActual: 1, subestado: "en_validacion_mesa" }),
      true,
    );
  });
  it("T3 etapa2 en_proceso → Disponible", () => {
    assert.equal(disp({ id: "t3", etapaActual: 2, subestado: "en_proceso" }), true);
  });
  it("T4 PENDING etapa1 → Disponible", () => {
    assert.equal(
      disp({
        id: "t4",
        etapaActual: 1,
        cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
      }),
      true,
    );
  });
  it("T5 PENDING etapa9 → Disponible", () => {
    assert.equal(
      disp({
        id: "t5",
        etapaActual: 9,
        cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
      }),
      true,
    );
  });
  it("T6 PENDING assigned otro → Disponible", () => {
    const merged = mergeExpedientesWithMesaOps(
      [
        item({
          id: "t6",
          etapaActual: 9,
          cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
        }),
      ],
      buildMesaOpsMap([
        ops({
          expedienteId: "t6",
          estadoMesa: "trabajando",
          assignedTo: USER_B,
          assignedAt: "x",
        }),
      ]),
    );
    assert.equal(esDisponibleParaMesa(merged[0]!), true);
    assert.equal(filterMesaOpsItems(merged, "sin_asignar", USER_A).length, 1);
  });
  it("T7 WAITING → NO", () => {
    assert.equal(
      disp({ id: "t7", etapaActual: 1, cambioRevisionEstado: "WAITING_ADVISOR" }),
      false,
    );
  });
  it("T8 ADVISOR_UPDATE → NO (P199 sí accionable)", () => {
    assert.equal(
      disp({
        id: "t8",
        etapaActual: 5,
        cambioRevisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      }),
      false,
    );
    assert.equal(
      disp({
        id: "t8b",
        etapaActual: 1,
        subestado: "en_proceso",
        cambioRevisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      }),
      false,
    );
    assert.equal(
      mesaEsTrabajoAccionableMesa({
        cicloEstado: "activo",
        cambioRevisionEstado: "ADVISOR_UPDATE_PENDING_REVIEW",
      }),
      true,
    );
  });
  it("T9 etapa5 en_proceso → NO", () => {
    assert.equal(disp({ id: "t9", etapaActual: 5, subestado: "en_proceso" }), false);
  });
  it("T10 etapa9 en_proceso → NO", () => {
    assert.equal(disp({ id: "t10", etapaActual: 9, subestado: "en_proceso" }), false);
  });
  it("T11 etapa12 pagado → NO", () => {
    assert.equal(disp({ id: "t11", etapaActual: 12, subestado: "en_proceso" }), false);
  });
  it("T12 etapa12 no_pagado → NO", () => {
    assert.equal(disp({ id: "t12", etapaActual: 12, subestado: "en_proceso" }), false);
  });
  it("T13 cancelado → NO", () => {
    assert.equal(
      disp({ id: "t13", etapaActual: 1, cicloEstado: "cancelado" }),
      false,
    );
  });
  it("T14 CLOSED etapa9 → NO", () => {
    assert.equal(
      disp({
        id: "t14",
        etapaActual: 9,
        cambioRevisionEstado: "CLOSED",
      }),
      false,
    );
  });
  it("T15 R1 respuesta → Disponible; T16 R2 WAITING → NO; T17 L2 → Disponible", () => {
    assert.equal(
      disp({
        id: "r",
        etapaActual: 3,
        cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
      }),
      true,
    );
    assert.equal(
      disp({ id: "r", etapaActual: 3, cambioRevisionEstado: "WAITING_ADVISOR" }),
      false,
    );
    assert.equal(
      disp({
        id: "r",
        etapaActual: 3,
        cambioRevisionEstado: "CORRECTION_PENDING_REVIEW",
      }),
      true,
    );
  });
  it("T18 assignment no cambia membership", () => {
    const base = item({ id: "t18", etapaActual: 1, subestado: "pendiente" });
    const a = mergeExpedientesWithMesaOps([base], buildMesaOpsMap([]));
    const b = mergeExpedientesWithMesaOps(
      [base],
      buildMesaOpsMap([
        ops({
          expedienteId: "t18",
          estadoMesa: "trabajando",
          assignedTo: USER_B,
          assignedAt: "x",
        }),
      ]),
    );
    assert.equal(esDisponibleParaMesa(a[0]!), esDisponibleParaMesa(b[0]!));
    assert.equal(esDisponibleParaMesa(a[0]!), true);
  });
  it("T19 quick Nuevos intacto (helper etapa 1-2)", () => {
    assert.equal(
      esNuevoEtapa12({
        etapaActual: 1,
        subestado: "pendiente",
        cicloEstado: "activo",
      }),
      true,
    );
    assert.equal(
      esNuevoEtapa12({
        etapaActual: 5,
        subestado: "en_proceso",
        cicloEstado: "activo",
      }),
      false,
    );
  });
  it("T20 P199 helper intacto (no es autoridad de Disponibles)", () => {
    assert.equal(
      mesaEsTrabajoAccionableMesa({
        cicloEstado: "activo",
        subestado: "en_proceso",
      }),
      true,
    );
    assert.equal(
      esDisponibleParaMesa(
        item({ id: "x", etapaActual: 5, subestado: "en_proceso" }),
      ),
      false,
    );
  });
});
