import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MockExpedienteRetencionEnvioMesaLocalStorageRepo,
  RETENCION_ENVIO_MESA_STORAGE_KEY,
} from "./envio-mesa.mock-localstorage.repo";

function installWindowStore(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  (globalThis as unknown as { window: object }).window = {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    },
    dispatchEvent: () => {},
  };
  return map;
}

describe("B0D6.2: envío retención markCorreccionRequerida", () => {
  it("marca correccion_requerida conservando fechaEnvioMesa y opcion", async () => {
    const fecha = "2026-05-27T10:00:00.000Z";
    const map = installWindowStore({
      [RETENCION_ENVIO_MESA_STORAGE_KEY]: JSON.stringify([
        {
          expedienteId: "exp-99",
          enviado: true,
          fechaEnvioMesa: fecha,
          opcion: "con_sello",
          estado: "enviado",
        },
      ]),
    });
    const repo = new MockExpedienteRetencionEnvioMesaLocalStorageRepo();
    const updated = await repo.markCorreccionRequerida("exp-99");
    assert.equal(updated?.estado, "correccion_requerida");
    assert.equal(updated?.fechaEnvioMesa, fecha);
    assert.equal(updated?.opcion, "con_sello");
    const raw = map.get(RETENCION_ENVIO_MESA_STORAGE_KEY);
    assert.ok(raw?.includes("correccion_requerida"));
  });
});
