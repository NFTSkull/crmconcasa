import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminFiscalAprobarBodySchema,
  assertNoPiiInItem,
  authorizeSuperAdmin,
  extractMotivoResumen,
  mapAprobarRpcError,
  maskNss,
  type AdminFiscalRevisionManualItem,
} from "./admin-aprobar-envio-mesa";

describe("admin-aprobar-envio-mesa domain", () => {
  it("authorizeSuperAdmin solo super_admin activo", () => {
    assert.equal(authorizeSuperAdmin("super_admin", true), true);
    assert.equal(authorizeSuperAdmin("super_admin", false), false);
    assert.equal(authorizeSuperAdmin("admin", true), false);
    assert.equal(authorizeSuperAdmin("mesa", true), false);
    assert.equal(authorizeSuperAdmin(null, true), false);
  });

  it("valida motivo >= 10", () => {
    assert.equal(
      AdminFiscalAprobarBodySchema.safeParse({
        expedienteId: "11111111-1111-4111-8111-111111111111",
        motivo: "corto",
      }).success,
      false,
    );
    assert.equal(
      AdminFiscalAprobarBodySchema.safeParse({
        expedienteId: "11111111-1111-4111-8111-111111111111",
        motivo: "Motivo de prueba OK",
      }).success,
      true,
    );
  });

  it("extractMotivoResumen prioriza code sin PII", () => {
    assert.equal(
      extractMotivoResumen({
        code: "SAT_CAPTCHA_UNSOLVED",
        semantic: "blocked",
        rfc: "XAXX010101000",
      }),
      "SAT_CAPTCHA_UNSOLVED",
    );
  });

  it("maskNss deja solo últimos 4", () => {
    assert.equal(maskNss("12345678901"), "***8901");
    assert.equal(maskNss("12"), "***");
  });

  it("assertNoPiiInItem rechaza RFC/CURP en payload", () => {
    const base: AdminFiscalRevisionManualItem = {
      expedienteId: "11111111-1111-4111-8111-111111111111",
      clienteNombre: "Cliente Demo",
      nssMasked: "***8901",
      asesorNombre: "Asesor",
      motivoResumen: "SAT_CAPTCHA_UNSOLVED",
      realizadoAt: null,
      submittedToMesa: false,
    };
    assert.doesNotThrow(() => assertNoPiiInItem(base));
    assert.throws(
      () => assertNoPiiInItem({ ...base, motivoResumen: "RFC XAXX010101000" }),
      /pii_rfc/,
    );
  });

  it("mapAprobarRpcError clasifica códigos", () => {
    assert.equal(mapAprobarRpcError("solo super_admin", "42501").status, 403);
    assert.equal(mapAprobarRpcError("motivo obligatorio (>=10)", "22023").status, 400);
    assert.equal(mapAprobarRpcError("requiere revision_manual vigente").status, 409);
    assert.equal(mapAprobarRpcError("Expediente no encontrado", "P0002").status, 404);
  });
});
