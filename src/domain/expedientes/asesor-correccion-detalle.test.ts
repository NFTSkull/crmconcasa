import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asesorCorreccionUxCopy,
  buildAsesorCorreccionViewFromDetalle,
  formatAsesorCorreccionInboxSecondary,
  type AsesorCorreccionDetalle,
} from "./asesor-correccion-detalle";
import { resolveAsesorCorreccionExplicacion } from "./asesor-correction-explanation";

/** T32 Mauricio fixture — motivo exacto, estado B, CTA habilitable. */
const MAURICIO_FIXTURE: AsesorCorreccionDetalle = {
  estado: "WAITING_ADVISOR",
  request_type: "SOLICITUD_DATOS_GENERALES",
  request_at: "2026-08-24T13:45:46.000Z",
  items: [
    {
      type: "datos_generales",
      key: "datos_generales",
      label: "Datos generales",
      motivo: "RFC DEL EDC NO EXISTE",
      requested_at: "2026-08-24T13:45:46.000Z",
      action_target: "datos_generales",
      local_status: "corregido_guardado",
    },
  ],
  has_correction_activity_after_request: true,
  has_response_after_request: false,
  needs_resubmit: true,
  can_resubmit: true,
  ux_state: "CAMBIOS_GUARDADOS_SIN_ENVIAR",
  blocking_reasons: [],
};

describe("P210 asesor-correccion-detalle", () => {
  it("T1/T32 motivo DG exacto Mauricio", () => {
    assert.equal(MAURICIO_FIXTURE.items[0]?.motivo, "RFC DEL EDC NO EXISTE");
  });

  it("T11 inbox secondary con motivo", () => {
    const text = formatAsesorCorreccionInboxSecondary({
      count: 1,
      labels: ["Datos generales"],
      first_motivo: "RFC DEL EDC NO EXISTE",
      ux_state: "CAMBIOS_GUARDADOS_SIN_ENVIAR",
    });
    assert.match(text ?? "", /Datos generales/);
    assert.match(text ?? "", /RFC DEL EDC NO EXISTE/);
  });

  it("T10 multi inbox compacto", () => {
    const text = formatAsesorCorreccionInboxSecondary({
      count: 2,
      labels: ["Datos generales", "Estado de cuenta"],
      first_motivo: "RFC DEL EDC NO EXISTE",
    });
    assert.match(text ?? "", /2 correcciones pendientes/);
    assert.match(text ?? "", /Datos generales · Estado de cuenta/);
  });

  it("T13 estado A copy", () => {
    assert.match(
      asesorCorreccionUxCopy("PENDIENTE_DE_CORREGIR") ?? "",
      /Corrige lo indicado por Mesa/,
    );
  });

  it("T14 estado B copy", () => {
    assert.match(
      asesorCorreccionUxCopy("CAMBIOS_GUARDADOS_SIN_ENVIAR") ?? "",
      /Falta reenviar/,
    );
  });

  it("T15 estado C copy", () => {
    assert.match(
      asesorCorreccionUxCopy("CORRECCION_ENVIADA") ?? "",
      /Corrección enviada/,
    );
  });

  it("T16/T17 view Mauricio: can resubmit + confirmación DG", () => {
    const view = buildAsesorCorreccionViewFromDetalle(
      MAURICIO_FIXTURE,
      "correccion_requerida",
    );
    assert.equal(view.uxState, "CAMBIOS_GUARDADOS_SIN_ENVIAR");
    assert.equal(view.canResubmit, true);
    assert.equal(view.needsDgConfirmation, true);
    assert.equal(view.showPanel, true);
  });

  it("T12 CTA disabled sin actividad", () => {
    const detalle: AsesorCorreccionDetalle = {
      ...MAURICIO_FIXTURE,
      has_correction_activity_after_request: false,
      can_resubmit: false,
      ux_state: "PENDIENTE_DE_CORREGIR",
      blocking_reasons: ["Primero realiza y guarda la corrección solicitada."],
      items: [
        {
          ...MAURICIO_FIXTURE.items[0]!,
          local_status: "pendiente",
        },
      ],
    };
    const view = buildAsesorCorreccionViewFromDetalle(
      detalle,
      "correccion_requerida",
    );
    assert.equal(view.canResubmit, false);
    assert.match(view.blockingReasons[0] ?? "", /Primero realiza/);
  });

  it("T19 multi gate — doc pendiente bloquea", () => {
    const detalle: AsesorCorreccionDetalle = {
      ...MAURICIO_FIXTURE,
      can_resubmit: false,
      items: [
        MAURICIO_FIXTURE.items[0]!,
        {
          type: "documento",
          key: "cliente_estado_cuenta",
          label: "Estado de cuenta",
          motivo: "ACTUALIZAR EDC",
          requested_at: "2026-08-24T13:45:46.000Z",
          action_target: "cliente_estado_cuenta",
          local_status: "pendiente",
        },
      ],
      blocking_reasons: ["Primero reemplaza: Estado de cuenta."],
    };
    const view = buildAsesorCorreccionViewFromDetalle(
      detalle,
      "correccion_requerida",
    );
    assert.equal(view.canResubmit, false);
  });

  it("T7 save sin diff → can_resubmit false (solo action_log noop)", () => {
    const detalle: AsesorCorreccionDetalle = {
      estado: "WAITING_ADVISOR",
      request_type: "SOLICITUD_DATOS_GENERALES",
      request_at: "2026-08-24T13:45:46.000Z",
      items: [
        {
          type: "datos_generales",
          key: "datos_generales",
          label: "Datos generales",
          motivo: "RFC DEL EDC NO EXISTE",
          requested_at: "2026-08-24T13:45:46.000Z",
          action_target: "datos_generales",
          local_status: "pendiente",
        },
      ],
      has_correction_activity_after_request: false,
      has_response_after_request: false,
      needs_resubmit: true,
      can_resubmit: false,
      ux_state: "PENDIENTE_DE_CORREGIR",
      blocking_reasons: ["Primero realiza y guarda la corrección solicitada."],
    };
    const view = buildAsesorCorreccionViewFromDetalle(
      detalle,
      "correccion_requerida",
    );
    assert.equal(view.canResubmit, false);
    assert.equal(detalle.has_correction_activity_after_request, false);
  });

  it("T23 P209 compat — resolve prefiere resumen P210", () => {
    const text = resolveAsesorCorreccionExplicacion({
      estadoEfectivo: "correccion_requerida",
      correccionExplicacion: "Mesa solicita corregir: Datos generales.",
      correccionResumen: {
        count: 1,
        labels: ["Datos generales"],
        first_motivo: "RFC DEL EDC NO EXISTE",
      },
    });
    assert.match(text ?? "", /RFC DEL EDC NO EXISTE/);
  });
});
