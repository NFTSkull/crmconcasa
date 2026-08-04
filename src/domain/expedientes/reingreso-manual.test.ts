import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReingresoManualEnvioPendientes,
  formatReingresoBadgeLabel,
  formatReingresoEnvioPendientesMessage,
  hasReingresoVisible,
  mapAsesorEnviarReingresoRpcError,
  puedeMostrarReingresoManualCard,
} from "./reingreso-manual";

describe("reingreso-manual helpers", () => {
  it("hasReingresoVisible: manual count", () => {
    assert.equal(
      hasReingresoVisible({
        reingresoManual: { count: 1, at: null, by: null },
      }),
      true,
    );
  });

  it("hasReingresoVisible: P072", () => {
    assert.equal(
      hasReingresoVisible({
        reingreso: {
          expedienteAnteriorId: "a",
          rechazoId: "b",
          rechazoEtapa: null,
          rechazoMotivo: null,
          rechazoComentario: null,
          biometricosCondicion: null,
          biometricosRazon: null,
        },
      }),
      true,
    );
  });

  it("hasReingresoVisible: sin marca", () => {
    assert.equal(hasReingresoVisible({}), false);
  });

  it("formatReingresoBadgeLabel", () => {
    assert.equal(formatReingresoBadgeLabel(1), "REINGRESO");
    assert.equal(formatReingresoBadgeLabel(2), "REINGRESO · 2");
  });

  it("puedeMostrarReingresoManualCard: activo asesor", () => {
    assert.equal(
      puedeMostrarReingresoManualCard({
        expedienteCancelado: false,
        role: "asesor",
      }),
      true,
    );
  });

  it("puedeMostrarReingresoManualCard: sin importar etapa/checklist (solo cancelado)", () => {
    assert.equal(
      puedeMostrarReingresoManualCard({ expedienteCancelado: false }),
      true,
    );
    assert.equal(
      puedeMostrarReingresoManualCard({ expedienteCancelado: true }),
      false,
    );
  });

  it("puedeMostrarReingresoManualCard: rol no asesor", () => {
    assert.equal(
      puedeMostrarReingresoManualCard({
        expedienteCancelado: false,
        role: "editor",
      }),
      false,
    );
  });

  it("buildReingresoManualEnvioPendientes: lista exacta docs + datos", () => {
    const pendientes = buildReingresoManualEnvioPendientes({
      hasMontoAprobado: true,
      datosGeneralesCompletos: false,
      camposFaltantesDatos: ["Domicilio real del cliente"],
      archivosResumen: [
        {
          expediente_id: "x",
          tipo_documento: "cliente_comprobante_domicilio",
          id: "1",
          nombre_original: "d.pdf",
          mime_type: "application/pdf",
          size_bytes: 1,
          created_at: null,
          uploaded_by_role: null,
          uploaded_by_email: null,
          estatus_revision: "subido",
          comentario_mesa: null,
        },
        {
          expediente_id: "x",
          tipo_documento: "cliente_estado_cuenta",
          id: "2",
          nombre_original: "e.pdf",
          mime_type: "application/pdf",
          size_bytes: 1,
          created_at: null,
          uploaded_by_role: null,
          uploaded_by_email: null,
          estatus_revision: "subido",
          comentario_mesa: null,
        },
      ],
    });
    assert.ok(pendientes.includes("Domicilio real del cliente"));
    assert.ok(pendientes.some((p) => /INE \(frente\)/i.test(p)));
    assert.ok(pendientes.some((p) => /INE \(reverso\)/i.test(p)));
    assert.equal(pendientes.includes("Comprobante de domicilio"), false);
    assert.equal(pendientes.includes("Estado de cuenta"), false);
    const msg = formatReingresoEnvioPendientesMessage(pendientes);
    assert.match(msg, /No puedes enviar todavía/);
  });

  it("mapAsesorEnviarReingresoRpcError: asesor ajeno", () => {
    const err = mapAsesorEnviarReingresoRpcError({
      message: "asesor_enviar_reingreso_a_mesa: solo el asesor dueño puede reingresar a Mesa",
    });
    assert.match(err.message, /permiso/i);
  });

  it("mapAsesorEnviarReingresoRpcError: cancelado", () => {
    const err = mapAsesorEnviarReingresoRpcError({
      message: "asesor_enviar_reingreso_a_mesa: el expediente está cancelado y no se puede reingresar",
    });
    assert.match(err.message, /cancelado/i);
  });

  it("mapAsesorEnviarReingresoRpcError: faltan datos/docs", () => {
    assert.match(
      mapAsesorEnviarReingresoRpcError({
        message: "asesor_enviar_reingreso_a_mesa: FALTAN_DATOS: faltan Datos Generales",
      }).message,
      /Datos Generales/i,
    );
    assert.match(
      mapAsesorEnviarReingresoRpcError({
        message: "asesor_enviar_reingreso_a_mesa: FALTAN_DOCS: faltan documentos obligatorios (2 de 4)",
      }).message,
      /documentos obligatorios/i,
    );
  });
});
