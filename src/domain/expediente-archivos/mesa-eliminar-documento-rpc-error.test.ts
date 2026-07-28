import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapMesaEliminarDocumentoRpcError } from "./mesa-eliminar-documento-rpc-error";

describe("mapMesaEliminarDocumentoRpcError", () => {
  it("mapea rol no autorizado", () => {
    const err = mapMesaEliminarDocumentoRpcError({
      message: "mesa_eliminar_documento: rol no autorizado (asesor)",
    });
    assert.match(err.message, /permiso/i);
  });

  it("mapea tipo no permitido", () => {
    const err = mapMesaEliminarDocumentoRpcError({
      message: "mesa_eliminar_documento: tipo_documento no permitido (cliente_solicitud)",
    });
    assert.match(err.message, /no se puede eliminar/i);
  });
});
