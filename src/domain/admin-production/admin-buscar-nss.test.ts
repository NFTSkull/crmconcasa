/**
 * Admin producción: p_buscar incluye NSS (paridad SQL mig 177).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesAdminProductionBuscar } from "./mock.repo";

describe("admin production buscar NSS", () => {
  it("match parcial por NSS", () => {
    assert.equal(
      matchesAdminProductionBuscar("7890", {
        clienteNombre: "Ana",
        asesorLabel: "Asesor",
        programa: "mejoravit",
        nss: "12345678901",
      }),
      true,
    );
  });

  it("sin match NSS no inventa hit", () => {
    assert.equal(
      matchesAdminProductionBuscar("00000", {
        clienteNombre: "Ana",
        asesorLabel: "Asesor",
        programa: "mejoravit",
        nss: "12345678901",
      }),
      false,
    );
  });

  it("sigue matcheando cliente", () => {
    assert.equal(
      matchesAdminProductionBuscar("ana", {
        clienteNombre: "Ana López",
        asesorLabel: "Asesor",
        programa: "mejoravit",
        nss: "12345678901",
      }),
      true,
    );
  });

  it("migration 177 + UI placeholder", () => {
    const mig = readFileSync(
      join(process.cwd(), "supabase/migrations/177_admin_buscar_nss.sql"),
      "utf8",
    );
    assert.match(mig, /coalesce\(e\.nss::text/);
    assert.match(mig, /admin_list_mesa_envios_page/);
    assert.match(mig, /admin_list_precalificaciones_page/);
    assert.match(mig, /admin_expedientes_snapshot_etapas/);
    assert.match(mig, /admin_list_expedientes_snapshot_page/);
    const page = readFileSync(
      join(process.cwd(), "src/app/admin/page.tsx"),
      "utf8",
    );
    assert.match(page, /Cliente, NSS, asesor, programa/);
  });
});
