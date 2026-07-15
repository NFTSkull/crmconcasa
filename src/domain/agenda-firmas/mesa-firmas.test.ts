import assert from "node:assert/strict";
import test from "node:test";
import {
  getMesaFirmasUiAccess,
  getMesaFirmasErrorCode,
  mesaBookFirmasInputSchema,
  mesaCancelFirmasInputSchema,
  mesaReagendarFirmasInputSchema,
} from "./mesa-firmas";

const base = {
  expedienteId: "00000000-0000-4000-8000-000000000001",
  bookingAt: "2026-08-10T10:00:00-06:00",
  timezone: "America/Monterrey",
  locationId: "mty-centro",
};

test("valida alta y reagenda Mesa con sede y timezone", () => {
  assert.equal(mesaBookFirmasInputSchema.safeParse(base).success, true);
  assert.equal(
    mesaReagendarFirmasInputSchema.safeParse({
      ...base,
      motivo: "Cambio solicitado",
    }).success,
    true,
  );
  assert.equal(
    mesaReagendarFirmasInputSchema.safeParse({ ...base, motivo: " " }).success,
    false,
  );
});

test("cancelación Mesa exige motivo", () => {
  assert.equal(
    mesaCancelFirmasInputSchema.safeParse({
      expedienteId: base.expedienteId,
      motivo: "Cancelación explícita",
    }).success,
    true,
  );
  assert.equal(
    mesaCancelFirmasInputSchema.safeParse({
      expedienteId: base.expedienteId,
      motivo: "",
    }).success,
    false,
  );
});

test("extrae códigos estables de firmas Mesa", () => {
  assert.equal(
    getMesaFirmasErrorCode({
      message: "MESA_SIGNATURE_NOT_VISIBLE: expediente no visible",
    }),
    "MESA_SIGNATURE_NOT_VISIBLE",
  );
});

test("UI habilita los cuatro roles Mesa y conserva cancelación fuera de 9/10", () => {
  for (const role of [
    "mesa_admin",
    "mesa_interno",
    "mesa_externo",
    "super_admin",
  ]) {
    assert.deepEqual(
      getMesaFirmasUiAccess({
        role,
        etapaActual: 9,
        hasActiveBooking: false,
      }),
      { visible: true, canCreate: true, canCancel: false },
    );
  }
  assert.deepEqual(
    getMesaFirmasUiAccess({
      role: "mesa_externo",
      etapaActual: 4,
      hasActiveBooking: true,
    }),
    { visible: true, canCreate: false, canCancel: true },
  );
  assert.equal(
    getMesaFirmasUiAccess({
      role: "asesor",
      etapaActual: 9,
      hasActiveBooking: true,
    }).visible,
    false,
  );
});
