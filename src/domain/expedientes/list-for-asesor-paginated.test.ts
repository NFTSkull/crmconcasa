import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExpedienteMock } from "./mock.repo";
import {
  normalizeAsesorPaginationOptions,
  paginateSortedExpedientes,
  sortExpedientesByCreatedAtDesc,
} from "./list-for-asesor-paginated";

function baseExp(
  partial: Partial<ExpedienteMock> & Pick<ExpedienteMock, "id">,
): ExpedienteMock {
  return {
    id: partial.id,
    base: {
      programa: "Mejoravit",
      nss: "12345678901",
      cliente_nombre: "Cliente",
      telefono_cliente: "5512345678",
      direccion_opcional: "",
      asesorId: "asesor@test.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      origenMesa: null,
      ...partial.base,
    },
    editorDecision: {
      decision: "pendiente",
      monto_aprobado: null,
      notas_revision: "",
      ...partial.editorDecision,
    },
    operativo: {
      etapaActual: 1,
      subestado: "pendiente",
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
      updatedAt: null,
      submittedToMesa: false,
      fechaEnvioMesa: null,
      cicloEstado: "activo",
      ...partial.operativo,
    },
  };
}

describe("listForAsesorPaginated (helpers)", () => {
  it("ordena por createdAt descendente", () => {
    const items = [
      baseExp({
        id: "old",
        base: { ...baseExp({ id: "x" }).base, createdAt: "2025-01-01T00:00:00.000Z" },
      }),
      baseExp({
        id: "new",
        base: { ...baseExp({ id: "x" }).base, createdAt: "2026-06-01T00:00:00.000Z" },
      }),
    ];
    const sorted = sortExpedientesByCreatedAtDesc(items);
    assert.deepEqual(
      sorted.map((x) => x.id),
      ["new", "old"],
    );
  });

  it("pagina con totalCount estable", () => {
    const sorted = sortExpedientesByCreatedAtDesc([
      baseExp({
        id: "a",
        base: { ...baseExp({ id: "x" }).base, createdAt: "2026-03-01T00:00:00.000Z" },
      }),
      baseExp({
        id: "b",
        base: { ...baseExp({ id: "x" }).base, createdAt: "2026-02-01T00:00:00.000Z" },
      }),
      baseExp({
        id: "c",
        base: { ...baseExp({ id: "x" }).base, createdAt: "2026-01-01T00:00:00.000Z" },
      }),
    ]);

    const page1 = paginateSortedExpedientes(sorted, { page: 1, pageSize: 2 });
    assert.equal(page1.totalCount, 3);
    assert.deepEqual(
      page1.items.map((x) => x.id),
      ["a", "b"],
    );

    const page2 = paginateSortedExpedientes(sorted, { page: 2, pageSize: 2 });
    assert.equal(page2.totalCount, 3);
    assert.deepEqual(
      page2.items.map((x) => x.id),
      ["c"],
    );
  });

  it("normaliza página y pageSize inválidos", () => {
    const norm = normalizeAsesorPaginationOptions({ page: 0, pageSize: 0 });
    assert.equal(norm.page, 1);
    assert.equal(norm.pageSize, 1);
    assert.equal(norm.from, 0);
    assert.equal(norm.to, 0);

    const capped = normalizeAsesorPaginationOptions({ page: 2, pageSize: 500 });
    assert.equal(capped.pageSize, 100);
    assert.equal(capped.from, 100);
    assert.equal(capped.to, 199);
  });
});
