import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MESA_DOCUMENTO_ELIMINAR_CONFIRM,
  MESA_DOCUMENTO_REPLACE_CONFIRM,
  MESA_TIPOS_DOCUMENTO_OPERATIVOS_MUTABLES,
  isMesaTipoDocumentoOperativoMutable,
} from "./mesa-documentos-operativos";

describe("P136 mesa-documentos-operativos", () => {
  it("allowlist estricta de 3 tipos", () => {
    assert.deepEqual([...MESA_TIPOS_DOCUMENTO_OPERATIVOS_MUTABLES], [
      "cliente_pagare",
      "cliente_notificacion",
      "cliente_notificacion_apodaca",
    ]);
    assert.equal(isMesaTipoDocumentoOperativoMutable("cliente_pagare"), true);
    assert.equal(isMesaTipoDocumentoOperativoMutable("cliente_solicitud"), false);
    assert.equal(isMesaTipoDocumentoOperativoMutable("notificacion"), false);
  });

  it("copies canónicos de confirmación", () => {
    assert.match(MESA_DOCUMENTO_REPLACE_CONFIRM, /reemplazado por la nueva versión/);
    assert.match(MESA_DOCUMENTO_ELIMINAR_CONFIRM, /Eliminar este documento/);
  });
});
