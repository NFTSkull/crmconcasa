import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import {
  clienteDatosCorreccionEnviadaPendiente,
  deriveMesaCorreccionLecturaEstado,
  deriveUltimaCorreccionDocumentoAt,
  deriveUltimaCorreccionEnviadaAt,
  mesaCorreccionLecturaLabel,
  mesaEntradaEsPorCorreccion,
  resolveFechaEntradaMesaActual,
} from "./mesaCorreccionEntrada";

function docRow(
  estatus: ExpedienteArchivoResumen["estatus_revision"],
  created_at: string,
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: "ine",
    id: "d1",
    nombre_original: "a.pdf",
    mime_type: "application/pdf",
    size_bytes: 1,
    created_at,
    uploaded_by_role: "asesor",
    uploaded_by_email: "a@b.c",
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

describe("mesaCorreccionEntrada", () => {
  it("deriveUltimaCorreccionDocumentoAt toma el resubido más reciente", () => {
    const at = deriveUltimaCorreccionDocumentoAt([
      docRow("resubido", "2026-07-01T10:00:00.000Z"),
      docRow("resubido", "2026-07-08T12:00:00.000Z"),
      docRow("validado", "2026-07-09T00:00:00.000Z"),
    ]);
    assert.equal(at, "2026-07-08T12:00:00.000Z");
  });

  it("clienteDatosCorreccionEnviadaPendiente: completo actualizado tras envío", () => {
    assert.equal(
      clienteDatosCorreccionEnviadaPendiente(
        {
          estado: "completo",
          updatedAt: "2026-07-08T15:00:00.000Z",
          validatedAt: null,
        },
        "2026-07-01T10:00:00.000Z",
      ),
      true,
    );
    assert.equal(
      clienteDatosCorreccionEnviadaPendiente(
        {
          estado: "completo",
          updatedAt: "2026-06-28T10:00:00.000Z",
          validatedAt: null,
        },
        "2026-07-01T10:00:00.000Z",
      ),
      false,
    );
  });

  it("resolveFechaEntradaMesaActual prioriza última corrección", () => {
    assert.equal(
      resolveFechaEntradaMesaActual(
        "2026-07-01T10:00:00.000Z",
        "2026-07-08T12:00:00.000Z",
      ),
      "2026-07-08T12:00:00.000Z",
    );
    assert.equal(
      resolveFechaEntradaMesaActual("2026-07-01T10:00:00.000Z", null),
      "2026-07-01T10:00:00.000Z",
    );
  });

  it("deriveUltimaCorreccionEnviadaAt combina documentos y datos generales", () => {
    const at = deriveUltimaCorreccionEnviadaAt({
      resumen: [docRow("resubido", "2026-07-05T10:00:00.000Z")],
      clienteDatos: {
        estado: "completo",
        updatedAt: "2026-07-08T15:00:00.000Z",
        validatedAt: null,
      },
      fechaEnvioMesa: "2026-07-01T10:00:00.000Z",
    });
    assert.equal(at, "2026-07-08T15:00:00.000Z");
  });

  it("primer envío a Mesa sin apertura → no abierto", () => {
    const fechaEntrada = resolveFechaEntradaMesaActual("2026-07-01T10:00:00.000Z", null);
    assert.equal(
      deriveMesaCorreccionLecturaEstado(fechaEntrada, null),
      "nueva",
    );
    assert.equal(mesaCorreccionLecturaLabel("nueva", false), "Nuevo en Mesa");
    assert.equal(mesaEntradaEsPorCorreccion(fechaEntrada, null), false);
  });

  it("primer envío a Mesa con apertura posterior → abierto", () => {
    const fechaEntrada = "2026-07-01T10:00:00.000Z";
    assert.equal(
      deriveMesaCorreccionLecturaEstado(fechaEntrada, "2026-07-01T11:00:00.000Z"),
      "abierta",
    );
    assert.equal(mesaCorreccionLecturaLabel("abierta", false), "Abierto");
  });

  it("corrección posterior a apertura → vuelve a no abierto", () => {
    const ultimaCorreccion = "2026-07-10T09:00:00.000Z";
    const fechaEntrada = resolveFechaEntradaMesaActual(
      "2026-07-01T10:00:00.000Z",
      ultimaCorreccion,
    );
    assert.equal(
      deriveMesaCorreccionLecturaEstado(fechaEntrada, "2026-07-08T13:00:00.000Z"),
      "nueva",
    );
    assert.equal(mesaEntradaEsPorCorreccion(fechaEntrada, ultimaCorreccion), true);
    assert.equal(mesaCorreccionLecturaLabel("nueva", true), "Corrección nueva");
  });

  it("apertura posterior a corrección → abierto", () => {
    const fechaEntrada = "2026-07-08T12:00:00.000Z";
    assert.equal(
      deriveMesaCorreccionLecturaEstado(fechaEntrada, "2026-07-08T13:00:00.000Z"),
      "abierta",
    );
    assert.equal(mesaCorreccionLecturaLabel("abierta", true), "Corrección abierta");
  });

  it("sin fechaEntradaMesaActual → no_aplica", () => {
    assert.equal(deriveMesaCorreccionLecturaEstado(null, null), "no_aplica");
  });
});
