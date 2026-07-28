import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapMesaEliminarDocumentoRpcError } from "./mesa-eliminar-documento-rpc-error";

describe("mapMesaEliminarDocumentoRpcError (P136 fix)", () => {
  it("mapea rol no autorizado a permisos", () => {
    const err = mapMesaEliminarDocumentoRpcError({
      message: "mesa_eliminar_documento: rol no autorizado (asesor)",
      code: "42501",
    });
    assert.equal(err.message, "No tienes permisos para eliminar este documento.");
  });

  it("mapea tipo no permitido", () => {
    const err = mapMesaEliminarDocumentoRpcError({
      message: "mesa_eliminar_documento: tipo_documento no permitido (cliente_solicitud)",
    });
    assert.match(err.message, /no se puede eliminar/i);
  });

  it("mapea conflicto concurrente", () => {
    const err = mapMesaEliminarDocumentoRpcError({
      message: "mesa_eliminar_documento: conflicto concurrente",
      code: "40001",
    });
    assert.match(err.message, /cambió mientras lo revisabas/i);
  });

  it("mapea fallo de firma log_action (bug P136 original)", () => {
    const err = mapMesaEliminarDocumentoRpcError({
      message:
        "function public.log_action(uuid, uuid, text, text, text, uuid, jsonb) does not exist",
      code: "42883",
      hint: "No function matches the given name and argument types.",
    });
    assert.match(err.message, /registrar la eliminación/i);
  });

  it("mapea documento no encontrado", () => {
    const err = mapMesaEliminarDocumentoRpcError({
      message: "mesa_eliminar_documento: expediente no encontrado",
      code: "P0002",
    });
    assert.equal(err.message, "El documento ya no está disponible.");
  });
});
