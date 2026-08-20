import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo11a12View,
  deriveCierreValidacionDocumentalView,
  puedeMostrarAvanceOperativo2a3,
  puedeMostrarAvanceOperativo5a6,
  puedeMostrarAvanceOperativo11a12,
  puedeMostrarContinuarIntegracion,
  type MesaContinuarIntegracionContext,
} from "./mesa-avance-integracion";
import {
  getMesaControlManualEstado,
  MESA_MOVE_RECHAZO_AUTO_REACTIVAR_AVISO,
  MESA_MOVIMIENTO_SUBESTADOS_ELEGIBLES,
} from "./mesa-movimiento-etapa";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";

function doc(
  tipo: ExpedienteArchivoResumen["tipo_documento"],
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "e1",
    tipo_documento: tipo,
    id: `${tipo}-id`,
    nombre_original: "x.pdf",
    mime_type: "application/pdf",
    size_bytes: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    uploaded_by_role: "asesor",
    uploaded_by_email: "a@x.com",
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

const baseDocsOk: ExpedienteArchivoResumen[] = [
  doc("cliente_ine_frente", "validado"),
  doc("cliente_ine_reverso", "validado"),
  doc("cliente_comprobante_domicilio", "validado"),
  doc("cliente_estado_cuenta", "validado"),
];

function cierreCtx(
  partial: Partial<MesaContinuarIntegracionContext> = {},
): MesaContinuarIntegracionContext {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 1,
    subestado: "en_validacion_mesa",
    clienteDatosEstado: "validado",
    archivosResumen: baseDocsOk,
    ...partial,
  };
}

describe("P204-D visibilidad avance normal con rechazo (N1–N4)", () => {
  it("N1 etapa1 + en_validacion_mesa → panel visible", () => {
    assert.equal(puedeMostrarContinuarIntegracion(cierreCtx()), true);
    assert.equal(deriveCierreValidacionDocumentalView(cierreCtx()).mostrar, true);
  });

  it("N2 etapa1 + rechazado → panel TAMBIÉN visible", () => {
    const ctx = cierreCtx({ subestado: "rechazado" });
    assert.equal(puedeMostrarContinuarIntegracion(ctx), true);
    const view = deriveCierreValidacionDocumentalView(ctx);
    assert.equal(view.mostrar, true);
  });

  it("N3 etapa1 rechazado + falta doc → botón visible disabled + razón", () => {
    const ctx = cierreCtx({
      subestado: "rechazado",
      archivosResumen: [
        doc("cliente_ine_frente", "faltante"),
        doc("cliente_ine_reverso", "validado"),
        doc("cliente_comprobante_domicilio", "validado"),
        doc("cliente_estado_cuenta", "validado"),
      ],
    });
    const view = deriveCierreValidacionDocumentalView(ctx);
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /INE frente|faltante/i.test(b)));
  });

  it("N4 etapa1 rechazado + DG/docs completos → botón enabled", () => {
    const view = deriveCierreValidacionDocumentalView(
      cierreCtx({ subestado: "rechazado" }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.equal(view.bloqueos.length, 0);
  });

  it("matriz: paneles 2/5/11 visibles con rechazado", () => {
    assert.equal(
      puedeMostrarAvanceOperativo2a3({
        submittedToMesa: true,
        cicloEstado: "activo",
        etapaActual: 2,
        subestado: "rechazado",
      }),
      true,
    );
    assert.equal(
      deriveAvanceOperativo2a3View({
        submittedToMesa: true,
        cicloEstado: "activo",
        etapaActual: 2,
        subestado: "rechazado",
      }).mostrar,
      true,
    );
    assert.equal(
      puedeMostrarAvanceOperativo5a6({
        submittedToMesa: true,
        cicloEstado: "activo",
        etapaActual: 5,
        subestado: "rechazado",
        fechaCita: "2020-01-01T00:00:00.000Z",
        hasActiveBiometricBooking: true,
      }),
      true,
    );
    assert.equal(
      puedeMostrarAvanceOperativo11a12({
        submittedToMesa: true,
        cicloEstado: "activo",
        etapaActual: 11,
        subestado: "rechazado",
      }),
      true,
    );
    assert.equal(
      deriveAvanceOperativo11a12View({
        submittedToMesa: true,
        cicloEstado: "activo",
        etapaActual: 11,
        subestado: "rechazado",
      }).mostrar,
      true,
    );
  });
});

describe("P204-D movimiento manual desde rechazo (M UI)", () => {
  it("rechazado habilita movimiento manual (override)", () => {
    const estado = getMesaControlManualEstado({
      role: "mesa_interno",
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "rechazado",
    });
    assert.equal(estado.visible, true);
    assert.equal(estado.habilitado, true);
    assert.equal(estado.razon, null);
    assert.ok(MESA_MOVIMIENTO_SUBESTADOS_ELEGIBLES.includes("rechazado"));
    assert.match(MESA_MOVE_RECHAZO_AUTO_REACTIVAR_AVISO, /reactivará automáticamente/i);
  });

  it("ciclo cancelado sigue bloqueado", () => {
    const estado = getMesaControlManualEstado({
      role: "mesa_interno",
      submittedToMesa: true,
      cicloEstado: "cancelado",
      subestado: "rechazado",
    });
    assert.equal(estado.habilitado, false);
  });

  it("no enviado sigue bloqueado", () => {
    const estado = getMesaControlManualEstado({
      role: "mesa_interno",
      submittedToMesa: false,
      cicloEstado: "activo",
      subestado: "rechazado",
    });
    assert.equal(estado.habilitado, false);
  });
});
