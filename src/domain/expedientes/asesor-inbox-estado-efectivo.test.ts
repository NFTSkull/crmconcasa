import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveAsesorInboxEstadoEfectivoMock,
  getAsesorInboxEstadoEfectivoPresentation,
} from "./asesor-inbox-estado-efectivo";
import { asesorEstadoActualFilaBadge } from "./asesor-inbox-fila-badges";

describe("asesor-inbox-estado-efectivo mock (P197)", () => {
  it("un estado efectivo: enviada gana sobre rechazo de columna", () => {
    const e = deriveAsesorInboxEstadoEfectivoMock({
      resultadoReal: "rechazado_mesa",
      categoriaCorreccion: "correccion_enviada",
    });
    assert.equal(e, "correccion_enviada");
  });

  it("necesita gana sobre rechazo de columna", () => {
    const e = deriveAsesorInboxEstadoEfectivoMock({
      resultadoReal: "rechazado_mesa",
      categoriaCorreccion: "correccion_requerida",
    });
    assert.equal(e, "correccion_requerida");
  });

  it("cancelado gana sobre correcciones", () => {
    const e = deriveAsesorInboxEstadoEfectivoMock({
      resultadoReal: "cancelado",
      categoriaCorreccion: "correccion_enviada",
    });
    assert.equal(e, "cancelado");
  });
});

describe("P197-B2 presentation (U9 mock = supabase)", () => {
  it("el mismo estado_efectivo produce el mismo label en mock y RPC", () => {
    const fromRpc = "correccion_enviada";
    const fromMockItem = deriveAsesorInboxEstadoEfectivoMock({
      resultadoReal: "rechazado_mesa",
      categoriaCorreccion: "correccion_enviada",
    });
    assert.equal(fromMockItem, fromRpc);
    assert.deepEqual(
      getAsesorInboxEstadoEfectivoPresentation(fromRpc),
      getAsesorInboxEstadoEfectivoPresentation(fromMockItem),
    );
    assert.equal(
      asesorEstadoActualFilaBadge(fromRpc).label,
      asesorEstadoActualFilaBadge(fromMockItem).label,
    );
  });
});
