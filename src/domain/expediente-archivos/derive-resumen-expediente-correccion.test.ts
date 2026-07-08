import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveResumenExpedienteCorreccion } from "./derive-resumen-expediente-correccion";
import type { ExpedienteArchivoResumen } from "./types";

function row(
  tipo: ExpedienteArchivoResumen["tipo_documento"],
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `${estatus}-${tipo}`,
    nombre_original: "x",
    mime_type: "application/pdf",
    size_bytes: 1,
    created_at: new Date().toISOString(),
    uploaded_by_role: "asesor",
    uploaded_by_email: "a@b.c",
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

describe("deriveResumenExpedienteCorreccion", () => {
  const todosValidados = [
    row("ine", "validado"),
    row("estado_cuenta", "validado"),
    row("nss", "validado"),
    row("direccion", "validado"),
  ];

  it("prioriza rechazo de datos generales sobre faltantes documentales", () => {
    assert.equal(
      deriveResumenExpedienteCorreccion(
        [row("ine", "faltante"), row("estado_cuenta", "validado"), row("nss", "validado"), row("direccion", "validado")],
        "rechazado",
      ),
      "correccion_requerida",
    );
  });

  it("marca corrección requerida cuando datos generales están rechazados", () => {
    assert.equal(
      deriveResumenExpedienteCorreccion(todosValidados, "rechazado"),
      "correccion_requerida",
    );
  });

  it("datos generales corregidos marcan correccion_enviada", () => {
    assert.equal(
      deriveResumenExpedienteCorreccion(todosValidados, {
        clienteDatosEstado: "completo",
        clienteDatosUpdatedAt: "2026-07-08T15:00:00.000Z",
        clienteDatosValidatedAt: null,
        fechaEnvioMesa: "2026-07-01T10:00:00.000Z",
      }),
      "correccion_enviada",
    );
  });

  it("delega al resumen documental si datos no están rechazados ni corregidos", () => {
    assert.equal(
      deriveResumenExpedienteCorreccion(todosValidados, "completo"),
      "documentos_validados",
    );
    assert.equal(
      deriveResumenExpedienteCorreccion(
        [row("ine", "rechazado"), ...todosValidados.slice(1)],
        "completo",
      ),
      "correccion_requerida",
    );
  });
});
