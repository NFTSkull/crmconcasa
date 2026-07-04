import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpedienteMock } from "./mock.repo";
import {
  EDITOR_LIST_PAGE_SIZE,
  buildEditorListOrFilter,
  matchesEditorListSearch,
  normalizeEditorListPage,
  sortEditorListItems,
} from "./editor-list-query";

function mockRow(
  id: string,
  patch?: {
    base?: Partial<ExpedienteMock["base"]>;
    operativo?: Partial<ExpedienteMock["operativo"]>;
  },
): ExpedienteMock {
  return {
    id,
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: "Cliente",
      telefono_cliente: "5512345678",
      direccion_opcional: "",
      asesorId: "asesor@test.com",
      createdAt: "2026-07-01T10:00:00.000Z",
      origenMesa: null,
      ...patch?.base,
    },
    editorDecision: {
      decision: "pendiente",
      monto_aprobado: null,
      notas_revision: "",
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
      ...patch?.operativo,
    },
  };
}

describe("editor-list-query", () => {
  it("normalizeEditorListPage — página 2 con tamaño 50", () => {
    assert.deepEqual(normalizeEditorListPage(2, EDITOR_LIST_PAGE_SIZE), {
      page: 2,
      pageSize: 50,
      from: 50,
      to: 99,
    });
  });

  it("sortEditorListItems — updated_at desc, luego created_at desc", () => {
    const sorted = sortEditorListItems([
      mockRow("a", {
        base: { createdAt: "2026-07-03T10:00:00.000Z" },
        operativo: { updatedAt: "2026-07-04T10:00:00.000Z" },
      }),
      mockRow("b", {
        base: { createdAt: "2026-07-04T12:00:00.000Z" },
        operativo: { updatedAt: "2026-07-04T11:00:00.000Z" },
      }),
    ]);
    assert.equal(sorted[0]?.id, "b");
    assert.equal(sorted[1]?.id, "a");
  });

  it("matchesEditorListSearch — cliente y asesor", () => {
    const row = mockRow("x", {
      base: {
        cliente_nombre: "MARIA LOPEZ",
        asesorEmail: "conchis.macias@concasa.mx",
      },
    });
    assert.equal(matchesEditorListSearch(row, "maria"), true);
    assert.equal(matchesEditorListSearch(row, "conchis"), true);
    assert.equal(matchesEditorListSearch(row, "zzz"), false);
  });

  it("buildEditorListOrFilter — sanitiza comas y comodines", () => {
    assert.equal(buildEditorListOrFilter(""), null);
    const f = buildEditorListOrFilter("maria, test");
    assert.ok(f?.includes("cliente_nombre.ilike.%maria test%"));
  });
});
