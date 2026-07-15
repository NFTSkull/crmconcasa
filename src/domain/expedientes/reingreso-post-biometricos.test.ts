import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getReingresoErrorCode,
  esExpedienteReingreso,
  iniciarReingresoResponseSchema,
  mapReingresoRpcError,
  puedeConsultarReingresoPostBiometricos,
  rechazoOperativoInputSchema,
  reingresoElegibilidadSchema,
} from "./reingreso-post-biometricos";

describe("contratos reingreso post-biométricos", () => {
  it("valida rechazo reutilizable con booking y razón", () => {
    const value = rechazoOperativoInputSchema.parse({
      motivo: "Proceso detenido",
      comentario: "Puede reinscribirse",
      biometricosCondicion: "reutilizables",
      biometricosRazon: "Mesa confirmó el intento",
      biometricosBookingId: "00000000-0000-4000-8000-000000000001",
    });
    assert.equal(value.biometricosCondicion, "reutilizables");
  });

  it("exige booking y razón para condiciones con intento", () => {
    for (const biometricosCondicion of [
      "reutilizables",
      "repetir",
      "invalidos",
    ] as const) {
      const result = rechazoOperativoInputSchema.safeParse({
        motivo: "Rechazo",
        biometricosCondicion,
      });
      assert.equal(result.success, false);
    }
  });

  it("permite desconocida y no_completados sin booking", () => {
    for (const biometricosCondicion of [
      "desconocida",
      "no_completados",
    ] as const) {
      assert.equal(
        rechazoOperativoInputSchema.safeParse({
          motivo: "Rechazo",
          biometricosCondicion,
        }).success,
        true,
      );
    }
  });

  it("valida respuestas de elegibilidad y creación", () => {
    assert.equal(
      reingresoElegibilidadSchema.parse({
        eligible: true,
        reason_code: "eligible",
        reason_message: null,
        rechazo_id: "00000000-0000-4000-8000-000000000001",
        biometricos_condicion: "reutilizables",
        existing_child_id: null,
      }).eligible,
      true,
    );

    assert.equal(
      iniciarReingresoResponseSchema.parse({
        ok: true,
        expediente_id: "00000000-0000-4000-8000-000000000002",
        expediente_anterior_id: "00000000-0000-4000-8000-000000000001",
        rechazo_id: "00000000-0000-4000-8000-000000000003",
        etapa_actual: 6,
        documentos_reutilizados: ["cliente_ine_frente"],
        documentos_pendientes: [
          "cliente_comprobante_domicilio",
          "cliente_estado_cuenta",
        ],
        monto_pendiente: true,
      }).etapa_actual,
      6,
    );
  });

  it("mapea códigos estables sin depender del texto restante", () => {
    const error = {
      code: "22023",
      message: "REENTRY_FUTURE_BOOKING_ACTIVE: detalle variable",
    };
    assert.equal(
      getReingresoErrorCode(error),
      "REENTRY_FUTURE_BOOKING_ACTIVE",
    );
    assert.match(mapReingresoRpcError(error).message, /cita biométrica futura/i);
  });

  it("solo consulta acción para padre rechazado activo en etapa 5/6", () => {
    assert.equal(
      puedeConsultarReingresoPostBiometricos({
        dataModeSupabase: true,
        etapaActual: 6,
        subestado: "rechazado",
        cicloEstado: "activo",
        esHijoReingreso: false,
      }),
      true,
    );
    assert.equal(
      puedeConsultarReingresoPostBiometricos({
        dataModeSupabase: true,
        etapaActual: 6,
        subestado: "en_proceso",
        cicloEstado: "activo",
        esHijoReingreso: false,
      }),
      false,
    );
    assert.equal(
      esExpedienteReingreso({
        expedienteAnteriorId: "padre",
        rechazoId: "rechazo",
      }),
      true,
    );
  });
});
