import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import {
  applyMesaOpsFilterSorted,
  DEFAULT_MESA_OPS_FILTER,
  filterMesaOpsItems,
  getMesaOpsStatusLabel,
  isAssignedToCurrentUser,
  isSinAsignarOps,
  MESA_OPS_FILTER_CHIPS,
  mergeExpedientesWithMesaOps,
  buildMesaOpsMap,
  resolveMesaOpsAdminCanRelease,
} from "@/lib/mesaOpsUi";

const USER_A = "00000000-0000-4000-8004-000000000001";
const USER_B = "00000000-0000-4000-8004-000000000002";

function ops(partial: Partial<MesaExpedienteOpsRow> & { expedienteId: string }): MesaExpedienteOpsRow {
  return {
    estadoMesa: "sin_asignar",
    assignedTo: null,
    assignedAt: null,
    lastActivityAt: null,
    assignedToName: null,
    ...partial,
  };
}

const items = [
  {
    id: "exp-old",
    fechaEnvioMesa: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "exp-mid",
    fechaEnvioMesa: "2026-02-01T10:00:00.000Z",
    createdAt: "2026-02-01T09:00:00.000Z",
  },
  {
    id: "exp-new",
    fechaEnvioMesa: "2026-03-01T10:00:00.000Z",
    createdAt: "2026-03-01T09:00:00.000Z",
  },
] as const;

describe("mesaOpsUi", () => {
  it("default operativo al cargar bandeja es Disponibles (sin_asignar)", () => {
    assert.equal(DEFAULT_MESA_OPS_FILTER, "sin_asignar");
    assert.equal(MESA_OPS_FILTER_CHIPS[0]?.id, "sin_asignar");
    assert.equal(MESA_OPS_FILTER_CHIPS[0]?.label, "Disponibles");
    assert.equal(MESA_OPS_FILTER_CHIPS.at(-1)?.id, "todo_mesa");
  });

  it("sin ops → Sin asignar", () => {
    assert.equal(getMesaOpsStatusLabel(null, USER_A), "Sin asignar");
    assert.equal(isSinAsignarOps(null), true);
  });

  it("ops sin_asignar → Sin asignar", () => {
    const row = ops({ expedienteId: "e1", estadoMesa: "sin_asignar" });
    assert.equal(getMesaOpsStatusLabel(row, USER_A), "Sin asignar");
  });

  it("assigned_to = currentUser → Trabajando por ti", () => {
    const row = ops({
      expedienteId: "e1",
      estadoMesa: "trabajando",
      assignedTo: USER_A,
      assignedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(getMesaOpsStatusLabel(row, USER_A), "Trabajando por ti");
    assert.equal(isAssignedToCurrentUser(row, USER_A), true);
  });

  it("assigned_to otro con nombre → Trabajando por X", () => {
    const row = ops({
      expedienteId: "e1",
      estadoMesa: "trabajando",
      assignedTo: USER_B,
      assignedAt: "2026-01-01T00:00:00.000Z",
      assignedToName: "María Mesa",
    });
    assert.equal(getMesaOpsStatusLabel(row, USER_A), "Trabajando por María Mesa");
  });

  it("assigned_to otro sin nombre → Trabajando por otro usuario", () => {
    const row = ops({
      expedienteId: "e1",
      estadoMesa: "trabajando",
      assignedTo: USER_B,
      assignedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(getMesaOpsStatusLabel(row, USER_A), "Trabajando por otro usuario");
  });

  it("filtro Todo Mesa conserva todos", () => {
    const merged = mergeExpedientesWithMesaOps(
      items,
      buildMesaOpsMap([
        ops({ expedienteId: "exp-mid", estadoMesa: "trabajando", assignedTo: USER_A, assignedAt: "x" }),
      ]),
    );
    assert.equal(filterMesaOpsItems(merged, "todo_mesa", USER_A).length, 3);
  });

  it("filtro Disponibles (sin_asignar) excluye assigned_to", () => {
    const merged = mergeExpedientesWithMesaOps(
      items,
      buildMesaOpsMap([
        ops({ expedienteId: "exp-mid", estadoMesa: "trabajando", assignedTo: USER_A, assignedAt: "x" }),
        ops({ expedienteId: "exp-old", estadoMesa: "trabajando", assignedTo: USER_B, assignedAt: "x" }),
      ]),
    );
    const filtered = filterMesaOpsItems(merged, "sin_asignar", USER_A);
    assert.equal(filtered.length, 1);
    assert.deepEqual(filtered.map((i) => i.id), ["exp-new"]);
  });

  it("filtro Sin asignar", () => {
    const merged = mergeExpedientesWithMesaOps(
      items,
      buildMesaOpsMap([
        ops({ expedienteId: "exp-mid", estadoMesa: "trabajando", assignedTo: USER_A, assignedAt: "x" }),
      ]),
    );
    const filtered = filterMesaOpsItems(merged, "sin_asignar", USER_A);
    assert.deepEqual(
      filtered.map((i) => i.id),
      ["exp-old", "exp-new"],
    );
  });

  it("filtro Mi bandeja", () => {
    const merged = mergeExpedientesWithMesaOps(
      items,
      buildMesaOpsMap([
        ops({ expedienteId: "exp-new", estadoMesa: "trabajando", assignedTo: USER_A, assignedAt: "x" }),
      ]),
    );
    const filtered = filterMesaOpsItems(merged, "mi_bandeja", USER_A);
    assert.deepEqual(filtered.map((i) => i.id), ["exp-new"]);
  });

  it("filtro En trabajo", () => {
    const merged = mergeExpedientesWithMesaOps(
      items,
      buildMesaOpsMap([
        ops({ expedienteId: "exp-old", estadoMesa: "trabajando", assignedTo: USER_B, assignedAt: "x" }),
      ]),
    );
    const filtered = filterMesaOpsItems(merged, "en_trabajo", USER_A);
    assert.deepEqual(filtered.map((i) => i.id), ["exp-old"]);
  });

  it("orden fecha_envio_mesa ASC tras filtrar Disponibles", () => {
    const merged = mergeExpedientesWithMesaOps(items, buildMesaOpsMap([]));
    const sorted = applyMesaOpsFilterSorted(merged, DEFAULT_MESA_OPS_FILTER, USER_A);
    assert.deepEqual(
      sorted.map((i) => i.id),
      ["exp-old", "exp-mid", "exp-new"],
    );
  });

  it("orden fecha_envio_mesa ASC tras filtrar", () => {
    const merged = mergeExpedientesWithMesaOps(
      items,
      buildMesaOpsMap([
        ops({ expedienteId: "exp-new", estadoMesa: "trabajando", assignedTo: USER_A, assignedAt: "x" }),
        ops({ expedienteId: "exp-old", estadoMesa: "trabajando", assignedTo: USER_A, assignedAt: "x" }),
      ]),
    );
    const sorted = applyMesaOpsFilterSorted(merged, "mi_bandeja", USER_A);
    assert.deepEqual(
      sorted.map((i) => i.id),
      ["exp-old", "exp-new"],
    );
  });

  it("admin release: app_role mesa_admin sin mock_user", () => {
    assert.equal(
      resolveMesaOpsAdminCanRelease({
        appRole: "mesa_admin",
        sessionRole: "mesa_control",
        mockRole: null,
      }),
      true,
    );
  });

  it("admin release: super_admin vía sesión", () => {
    assert.equal(
      resolveMesaOpsAdminCanRelease({
        appRole: null,
        sessionRole: "super_admin",
        mockRole: null,
      }),
      true,
    );
  });

  it("admin release: mock mesa_control_admin como fallback dev", () => {
    assert.equal(
      resolveMesaOpsAdminCanRelease({
        appRole: null,
        sessionRole: "mesa_control",
        mockRole: "mesa_control_admin",
      }),
      true,
    );
  });

  it("admin release: mesa interno sin app admin ni mock", () => {
    assert.equal(
      resolveMesaOpsAdminCanRelease({
        appRole: "mesa_interno",
        sessionRole: "mesa_control",
        mockRole: "mesa_control_interno",
      }),
      false,
    );
  });
});
