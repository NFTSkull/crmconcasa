import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const sql = src("supabase/migrations/20261105194000_casas_admin_notificaciones_vistas.sql");
const tabs = src("src/components/admin/AdminTabs.tsx");
const adminCasas = src("src/app/admin/casas/page.tsx");

describe("Admin: notificaciones de Compra de casas", () => {
  it("cuenta solo casas enviadas sin leer por admin y organización", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.casas_admin_bandeja_vistas/);
    assert.match(sql, /admin_id uuid PRIMARY KEY/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.casas_admin_nuevas_count/);
    assert.match(sql, /s\.estado = 'enviada'/);
    assert.match(sql, /s\.enviada_at > COALESCE\(v_vista_hasta/);
    assert.match(sql, /v\.admin_id = v_admin AND v\.organization_id = v_org/);
    assert.match(sql, /p\.active AND p\.app_role = 'super_admin'/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.casas_admin_bandeja_vistas FROM PUBLIC, anon, authenticated/);
  });

  it("badge muestra SOLO nuevas sin leer; vuelve a consultar al regresar y cada 20s", () => {
    assert.match(tabs, /\.rpc\("casas_admin_nuevas_count"\)/);
    assert.match(tabs, /20_000/);
    assert.match(tabs, /visibilitychange/);
    assert.match(tabs, /addEventListener\("focus"/);
    assert.match(tabs, /casas nuevas sin revisar/);
    assert.match(tabs, /nuevasCasas > 99 \? "99\+"/);
    assert.doesNotMatch(tabs, /\.eq\("estado", "enviada"\)/);
    assert.doesNotMatch(tabs, /pendingCasas/);
  });

  it("al abrir la bandeja marca solo solicitudes cargadas sin quitar pendientes", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.casas_admin_marcar_bandeja_vista/);
    assert.match(sql, /LEAST\(COALESCE\(p_hasta, statement_timestamp\(\)\), statement_timestamp\(\)\)/);
    assert.match(sql, /GREATEST\(public\.casas_admin_bandeja_vistas\.vista_hasta, EXCLUDED\.vista_hasta\)/);
    assert.match(adminCasas, /\.rpc\("casas_admin_marcar_bandeja_vista"/);
    assert.match(adminCasas, /p_hasta: ultimaRecibida/);
    assert.match(adminCasas, /setList\(items\)/);
    assert.match(adminCasas, /enviada: list\.filter\(\(c\) => c\.estado === "enviada"\)\.length/);
    assert.match(adminCasas, /casas_responder/);
  });

  it("rol de asesor/anon no puede manipular el historial de lectura", () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.casas_admin_nuevas_count\(\)/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.casas_admin_marcar_bandeja_vista\(timestamptz\)/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.casas_admin_nuevas_count\(\)/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.casas_admin_marcar_bandeja_vista\(timestamptz\)/);
  });
});
