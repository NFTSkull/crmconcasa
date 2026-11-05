import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const source = (path: string) => readFileSync(join(process.cwd(),path),"utf8");
const migration = source("supabase/migrations/20261105170000_casas_solicitudes_modulo_seguro.sql");
const advisor = source("src/app/asesor/casas/page.tsx");
const detail = source("src/app/asesor/casas/[id]/page.tsx");
const admin = source("src/app/admin/casas/page.tsx");
const nav = source("src/components/admin/AdminTabs.tsx");
const advisorIndex = source("src/app/asesor/page.tsx");

describe("Compra de casas: contrato de aislamiento y revisión",()=>{
  it("RLS habilitado y datos ligados a asesor y organización",()=>{
    for(const table of ["casas_solicitudes","casas_fotos","casas_historial"]){
      assert.match(migration,new RegExp("ALTER TABLE public\\."+table+" ENABLE ROW LEVEL SECURITY"));
    }
    assert.match(migration,/asesor_id=\(SELECT auth\.uid\(\)\)/);
    assert.match(migration,/p\.organization_id=casas_solicitudes\.organization_id/);
    assert.match(migration,/p\.app_role='super_admin'/);
    assert.match(migration,/REVOKE ALL ON TABLE public\.casas_solicitudes,public\.casas_fotos,public\.casas_historial FROM PUBLIC,anon,authenticated/);
    assert.doesNotMatch(migration,/GRANT\s+UPDATE\s+ON\s+public\.casas_solicitudes/i);
  });
  it("oferta o rechazo solo pasan por RPC admin con motivo obligatorio",()=>{
    assert.match(migration,/CREATE OR REPLACE FUNCTION public\.casas_responder/);
    assert.match(migration,/p\.app_role='super_admin'/);
    assert.match(migration,/p_accion='oferta'/);
    assert.match(migration,/p_monto_mxn<=0/);
    assert.match(migration,/p_accion='rechazo'/);
    assert.match(migration,/btrim\(coalesce\(p_motivo,''\)\)=''/);
    assert.match(migration,/INSERT INTO public\.casas_historial/);
    assert.match(admin,/\.rpc\("casas_responder"/);
    assert.match(detail,/\.rpc\("casas_enviar"/);
  });
  it("fotos privadas, solo propietario en borrador, sin bucket público",()=>{
    assert.match(migration,/VALUES\('casas-fotos','casas-fotos',false/);
    assert.match(migration,/CREATE POLICY casas_storage_read/);
    assert.match(migration,/CREATE POLICY casas_storage_insert/);
    assert.match(migration,/CREATE POLICY casas_storage_delete/);
    assert.match(migration,/s\.estado='borrador'/);
    assert.match(migration,/v_count>=12/);
    assert.match(detail,/image\/jpeg,image\/png,image\/webp/);
    assert.match(source("src/domain/casas/casas-client.ts"),/createSignedUrl/);
  });
  it("flujo separado de Mesa: asesor->administrador con accesos",()=>{
    assert.match(advisor,/Nueva oportunidad de compra/);
    assert.match(advisor,/Todos los datos son opcionales/);
    assert.match(nav,/href="\/admin\/casas"/);
    assert.match(advisorIndex,/href="\/asesor\/casas"/);
    assert.doesNotMatch(migration,/UPDATE\s+public\.expedientes/i);
    assert.doesNotMatch(migration,/enviar_a_mesa/i);
  });
});
