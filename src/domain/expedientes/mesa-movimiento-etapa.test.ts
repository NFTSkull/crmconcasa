import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMesaMovimientoAdvertencias,
  getMesaControlManualEstado,
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

test("control manual habilitado para subestado pendiente (P076)", () => {
  for (const role of [
    "mesa_admin",
    "mesa_interno",
    "mesa_externo",
    "super_admin",
  ]) {
    assert.deepEqual(
      getMesaControlManualEstado({
        role,
        submittedToMesa: true,
        cicloEstado: "activo",
        subestado: "pendiente",
      }),
      { visible: true, habilitado: true, razon: null },
    );
  }
  assert.equal(
    puedeMostrarControlManualMesa({
      role: "mesa_admin",
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "pendiente",
    }),
    true,
  );
});

test("panel deshabilitado con razón exacta, no oculto, para no elegibles", () => {
  const base = {
    role: "mesa_admin",
    submittedToMesa: true,
    cicloEstado: "activo",
    subestado: "en_proceso",
  };

  const noEnviado = getMesaControlManualEstado({
    ...base,
    submittedToMesa: false,
  });
  assert.equal(noEnviado.visible, true);
  assert.equal(noEnviado.habilitado, false);
  assert.equal(noEnviado.razon, "El expediente no ha sido enviado a Mesa.");

  const cerrado = getMesaControlManualEstado({
    ...base,
    cicloEstado: "cerrado",
  });
  assert.equal(cerrado.visible, true);
  assert.equal(cerrado.habilitado, false);
  assert.equal(cerrado.razon, "El ciclo está cerrado.");

  const cancelado = getMesaControlManualEstado({
    ...base,
    cicloEstado: "cancelado",
  });
  assert.equal(cancelado.visible, true);
  assert.equal(cancelado.habilitado, false);
  assert.equal(cancelado.razon, "El ciclo está cancelado.");

  const rechazado = getMesaControlManualEstado({
    ...base,
    subestado: "rechazado",
  });
  assert.equal(rechazado.visible, true);
  assert.equal(rechazado.habilitado, false);
  assert.equal(
    rechazado.razon,
    "El expediente está rechazado y requiere una reactivación explícita.",
  );

  const aprobado = getMesaControlManualEstado({
    ...base,
    subestado: "aprobado",
  });
  assert.equal(aprobado.visible, true);
  assert.equal(aprobado.habilitado, false);
  assert.equal(
    aprobado.razon,
    "El expediente debe estar pendiente, en validación de Mesa o en proceso.",
  );
});

test("asesor y editor no ven el control manual (panel oculto)", () => {
  for (const role of ["asesor", "editor", null, undefined, ""]) {
    const estado = getMesaControlManualEstado({
      role,
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "pendiente",
    });
    assert.equal(estado.visible, false);
    assert.equal(estado.habilitado, false);
  }
});

test("extrae códigos estables sin depender del texto posterior", () => {
  assert.equal(
    getMesaMovimientoErrorCode({
      message: "MESA_MOVE_STAGE_CONFLICT: etapa actual 7, esperada 6",
    }),
    "MESA_MOVE_STAGE_CONFLICT",
  );
  assert.equal(
    getMesaMovimientoErrorCode({
      message: "MESA_MOVE_BAD_SUBSTATE: subestado no elegible (aprobado)",
    }),
    "MESA_MOVE_BAD_SUBSTATE",
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
