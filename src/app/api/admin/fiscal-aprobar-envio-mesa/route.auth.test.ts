import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AdminFiscalAprobarBodySchema,
  authorizeSuperAdmin,
  mapAprobarRpcError,
} from "@/domain/validacion-fiscal/admin-aprobar-envio-mesa";

const EXP = "11111111-1111-4111-8111-111111111111";

describe("admin fiscal aprobar — auth y contrato", () => {
  it("super_admin activo autorizado; mesa_admin y asesor no", () => {
    assert.equal(authorizeSuperAdmin("super_admin", true), true);
    assert.equal(authorizeSuperAdmin("mesa_admin", true), false);
    assert.equal(authorizeSuperAdmin("asesor", true), false);
    assert.equal(authorizeSuperAdmin("super_admin", false), false);
  });

  it("motivo corto rechazado; motivo >=10 aceptado", () => {
    assert.equal(
      AdminFiscalAprobarBodySchema.safeParse({
        expedienteId: EXP,
        motivo: "corto",
      }).success,
      false,
    );
    assert.equal(
      AdminFiscalAprobarBodySchema.safeParse({
        expedienteId: EXP,
        motivo: "Excepción documentada OK",
      }).success,
      true,
    );
  });

  it("mapAprobarRpcError: solo super_admin → 403", () => {
    assert.equal(mapAprobarRpcError("solo super_admin", "42501").status, 403);
  });

  it("route POST usa Zod, authorizeSuperAdmin y RPC admin_aprobar", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/admin/fiscal-aprobar-envio-mesa/route.ts"),
      "utf8",
    );
    assert.match(src, /AdminFiscalAprobarBodySchema/);
    assert.match(src, /authorizeSuperAdmin/);
    assert.match(src, /admin_aprobar_envio_mesa_sin_fiscal/);
    assert.match(src, /createUserSupabaseClient/);
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("route GET listado filtra REVISION_MANUAL y enmascara NSS", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/admin/fiscal-revision-manual/route.ts"),
      "utf8",
    );
    assert.match(src, /FISCAL_REVISION_MANUAL_ESTADO/);
    assert.match(src, /authorizeSuperAdmin/);
    assert.match(src, /maskNss/);
    assert.match(src, /assertNoPiiInItem/);
    assert.match(src, /createServiceSupabaseClient/);
  });

  it("UI panel solo en admin y botón con copy exacto", () => {
    const panel = readFileSync(
      join(process.cwd(), "src/components/admin/AdminFiscalRevisionManualPanel.tsx"),
      "utf8",
    );
    const listPage = readFileSync(
      join(process.cwd(), "src/app/admin/expedientes/page.tsx"),
      "utf8",
    );
    const detailPage = readFileSync(
      join(process.cwd(), "src/app/admin/expedientes/[id]/page.tsx"),
      "utf8",
    );
    assert.match(panel, /Aprobar envío sin validación SAT/);
    assert.match(panel, /postAdminFiscalAprobarEnvioMesa/);
    assert.match(listPage, /AdminFiscalRevisionManualPanel/);
    assert.match(detailPage, /AdminFiscalRevisionManualPanel/);
  });
});
