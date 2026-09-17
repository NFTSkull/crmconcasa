import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MESA_ORIGEN_FILTER_CAPABILITY,
  canFilterMesaOrigen,
} from "./mesaOrigenFilterAccess";

describe("Mesa origen filter access", () => {
  it("usa la capability canónica de externos", () => {
    assert.equal(MESA_ORIGEN_FILTER_CAPABILITY, "ver_externos_mesa");
  });

  it("mantiene acceso para administración y rol legacy", () => {
    assert.equal(canFilterMesaOrigen({ mockRole: "mesa_control_admin" }), true);
    assert.equal(canFilterMesaOrigen({ mockRole: "mesa_control" }), true);
    assert.equal(canFilterMesaOrigen({ sessionRole: "mesa_control_admin" }), true);
  });

  it("habilita Mesa Interno solo cuando tiene ver_externos_mesa", () => {
    assert.equal(
      canFilterMesaOrigen({
        sessionRole: "mesa_control_interno",
        hasExternalCapability: true,
      }),
      true,
    );
    assert.equal(
      canFilterMesaOrigen({
        sessionRole: "mesa_control_interno",
        hasExternalCapability: false,
      }),
      false,
    );
  });

  it("no amplía acceso de Mesa Externo ni asesores", () => {
    assert.equal(
      canFilterMesaOrigen({
        sessionRole: "mesa_control_externo",
        hasExternalCapability: true,
      }),
      false,
    );
    assert.equal(
      canFilterMesaOrigen({ sessionRole: "asesor", hasExternalCapability: true }),
      false,
    );
  });
});
