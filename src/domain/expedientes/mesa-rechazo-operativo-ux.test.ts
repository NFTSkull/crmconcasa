import assert from "node:assert/strict";
import { test } from "node:test";
import {
  esElegibleRechazoOperativoPostBiometricos,
  mensajeAdvertenciaMotivoPareceRechazo,
  MESA_MOTIVO_PARECE_RECHAZO_SIN_ELEGIBILIDAD_WARNING,
  MESA_MOTIVO_PARECE_RECHAZO_WARNING,
  motivoManualPareceRechazo,
} from "./mesa-rechazo-operativo-ux";

test("motivoManualPareceRechazo detecta variantes de rechazo sin inferir acción", () => {
  assert.equal(motivoManualPareceRechazo("RECHAZO, BURO DE CREDITO"), true);
  assert.equal(motivoManualPareceRechazo("rechazado por MCI"), true);
  assert.equal(motivoManualPareceRechazo("Se rechaza por buro"), true);
  assert.equal(motivoManualPareceRechazo("Salto autorizado por mesa"), false);
  assert.equal(motivoManualPareceRechazo(""), false);
});

test("esElegibleRechazoOperativoPostBiometricos solo etapas 5/6 activas enviadas", () => {
  const base = {
    submittedToMesa: true,
    cicloEstado: "activo",
    subestado: "en_proceso",
    etapaActual: 5,
  };
  assert.equal(esElegibleRechazoOperativoPostBiometricos(base), true);
  assert.equal(
    esElegibleRechazoOperativoPostBiometricos({ ...base, etapaActual: 6 }),
    true,
  );
  assert.equal(
    esElegibleRechazoOperativoPostBiometricos({ ...base, etapaActual: 4 }),
    false,
  );
  assert.equal(
    esElegibleRechazoOperativoPostBiometricos({
      ...base,
      subestado: "rechazado",
    }),
    false,
  );
  assert.equal(
    esElegibleRechazoOperativoPostBiometricos({
      ...base,
      submittedToMesa: false,
    }),
    false,
  );
  assert.equal(
    esElegibleRechazoOperativoPostBiometricos({
      ...base,
      cicloEstado: "cerrado",
    }),
    false,
  );
});

test("mensajeAdvertenciaMotivoPareceRechazo distingue elegibilidad", () => {
  assert.equal(
    mensajeAdvertenciaMotivoPareceRechazo(true),
    MESA_MOTIVO_PARECE_RECHAZO_WARNING,
  );
  assert.equal(
    mensajeAdvertenciaMotivoPareceRechazo(false),
    MESA_MOTIVO_PARECE_RECHAZO_SIN_ELEGIBILIDAD_WARNING,
  );
});
