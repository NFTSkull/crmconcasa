import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapRegisterMesaDocumentoRpcError } from "./register-mesa-documento-rpc-error";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";

describe("mapRegisterMesaDocumentoRpcError", () => {
  it("mapea rol no autorizado", () => {
    const err = mapRegisterMesaDocumentoRpcError({ message: "rol no autorizado para esta operación" });
    assert.ok(err instanceof ExpedienteArchivosSupabaseError);
    assert.match(err.message, /Solo Mesa de control/i);
  });

  it("mapea tipo no permitido", () => {
    const err = mapRegisterMesaDocumentoRpcError({ message: "tipo_documento no permitido" });
    assert.match(err.message, /no puede subirlo Mesa/i);
  });

  it("mapea expediente no enviado a Mesa", () => {
    const err = mapRegisterMesaDocumentoRpcError({ message: "aún no fue enviado a mesa" });
    assert.match(err.message, /enviado a Mesa/i);
  });

  it("mapea gate de etapa Pagaré", () => {
    const err = mapRegisterMesaDocumentoRpcError({
      message:
        "register_mesa_documento: El Pagaré solo puede cargarse después de concluir la inscripción.",
    });
    assert.match(err.message, /después de concluir la inscripción/i);
  });

  it("mapea MIME no permitido sin asumir solo PDF", () => {
    const err = mapRegisterMesaDocumentoRpcError({
      message: "register_mesa_documento: mime_type no permitido (image/gif)",
    });
    assert.match(err.message, /formato/i);
  });
});
