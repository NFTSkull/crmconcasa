import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMesaMovimientoAdvertencias,
  getMesaMovimientoDireccion,
  getMesaMovimientoErrorCode,
  mesaMovimientoInputSchema,
  puedeConfirmarMovimientoMesa,
  puedeMostrarControlManualMesa,
} from "./mesa-movimiento-etapa";

test("valida destino, etapa esperada y motivo", () => {
  assert.equal(
    mesaMovimientoInputSchema.safeParse({
      etapaDestino: 12,
      etapaEsperada: 1,
      motivo: "Salto operativo",
    }).success,
    true,
  );
  assert.equal(
    mesaMovimientoInputSchema.safeParse({
      etapaDestino: 13,
      etapaEsperada: 1,
      motivo: "",
    }).success,
    false,
  );
});

test("deriva avance, retroceso y salto", () => {
  assert.equal(getMesaMovimientoDireccion(4, 5), "avance");
  assert.equal(getMesaMovimientoDireccion(5, 4), "retroceso");
  assert.equal(getMesaMovimientoDireccion(2, 9), "salto");
});

test("control manual solo se muestra a Mesa con estado elegible", () => {
  assert.equal(
    puedeMostrarControlManualMesa({
      role: "mesa_control_interno",
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "en_proceso",
    }),
    true,
  );
  for (const role of ["asesor", "editor"]) {
    assert.equal(
      puedeMostrarControlManualMesa({
        role,
        submittedToMesa: true,
        cicloEstado: "activo",
        subestado: "en_proceso",
      }),
      false,
    );
  }
  assert.equal(
    puedeMostrarControlManualMesa({
      role: "mesa_admin",
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "rechazado",
    }),
    false,
  );
});

test("extrae códigos estables sin depender del texto posterior", () => {
  assert.equal(
    getMesaMovimientoErrorCode({
      message: "MESA_MOVE_STAGE_CONFLICT: etapa actual 7, esperada 6",
    }),
    "MESA_MOVE_STAGE_CONFLICT",
  );
});

test("advertencias son informativas y cubren saltos/11-12/bookings", () => {
  const warnings = deriveMesaMovimientoAdvertencias({
    etapaActual: 9,
    etapaDestino: 12,
    hasBiometricBooking: false,
    hasFirmasBooking: true,
    hasMonto: false,
    hasMissingDocuments: true,
    hasRetencion: true,
    hasValidatedData: true,
  });
  assert.ok(warnings.some((value) => value.includes("booking de firmas activo")));
  assert.ok(warnings.some((value) => value.includes("saltando")));
  assert.ok(warnings.some((value) => value.includes("firma o un pago")));
});

test("motivo y saving bloquean confirmación y doble clic", () => {
  assert.equal(
    puedeConfirmarMovimientoMesa({
      etapaActual: 3,
      etapaDestino: 8,
      motivo: "",
      saving: false,
    }),
    false,
  );
  assert.equal(
    puedeConfirmarMovimientoMesa({
      etapaActual: 3,
      etapaDestino: 8,
      motivo: "Salto autorizado",
      saving: true,
    }),
    false,
  );
  assert.equal(
    puedeConfirmarMovimientoMesa({
      etapaActual: 3,
      etapaDestino: 8,
      motivo: "Salto autorizado",
      saving: false,
    }),
    true,
  );
});
