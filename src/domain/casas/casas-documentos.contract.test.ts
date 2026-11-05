import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = src("supabase/migrations/20261105190000_casas_checklist_documentos_privados.sql");
const catalogo = src("src/domain/casas/casas-documentos.ts");
const componente = src("src/components/casas/CasaChecklistDocumental.tsx");
const asesorForm = src("src/app/asesor/casas/page.tsx");
const asesorDetalle = src("src/app/asesor/casas/[id]/page.tsx");
const admin = src("src/app/admin/casas/page.tsx");
const pausado = src("src/app/asesor/casas/layout.tsx");

describe("Compra de casas · checklist documental", () => {
  it("replica cuatro apartados y 17 tipos; validación INE tachada se excluye", () => {
    for (const group of ["titular", "conyuge", "servicios", "exencion"]) {
      assert.match(catalogo, new RegExp('id: "' + group + '"'));
    }
    for (const type of [
      "escritura", "estado_cuenta_infonavit", "ine_titular", "acta_nacimiento_titular",
      "curp_titular", "rfc_titular", "acta_matrimonio", "acta_divorcio",
      "ine_conyuge", "acta_nacimiento_conyuge", "curp_conyuge", "rfc_conyuge",
      "predial", "agua_drenaje", "cfe", "gas", "factura_2014_calculo_impuesto"
    ]) assert.match(catalogo, new RegExp('id: "' + type + '"'));
    assert.doesNotMatch(migration, /validacion_ine/);
    assert.doesNotMatch(catalogo, /id: "validacion_ine"/);
  });

  it("protege documentos privados por asesor y organización y solo en borrador", () => {
    assert.match(migration, /ALTER TABLE public\.casas_documentos ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /VALUES \(\s*'casas-documentos','casas-documentos',false/);
    assert.match(migration, /CREATE POLICY casas_documentos_read/);
    assert.match(migration, /CREATE POLICY casas_documentos_upload_draft/);
    assert.match(migration, /CREATE POLICY casas_documentos_storage_read/);
    assert.match(migration, /CREATE POLICY casas_documentos_storage_insert/);
    assert.match(migration, /s\.asesor_id=\(SELECT auth\.uid\(\)\)/);
    assert.match(migration, /s\.estado='borrador'/);
    assert.match(migration, /v_count >= 4/);
    assert.match(componente, /createSignedUrl|cargarDocumentosCasa/);
    assert.match(catalogo, /createSignedUrl/);
    assert.doesNotMatch(catalogo, /getPublicUrl/);
  });

  it("el envío exige INE del titular y cónyuge si aplica, sin limitar otros opcionales", () => {
    assert.match(migration, /d\.tipo_documento='ine_titular'/);
    assert.match(migration, /v_row\.conyuge_aplica IS TRUE/);
    assert.match(migration, /d\.tipo_documento='ine_conyuge'/);
    assert.match(asesorDetalle, /checklistStatus\.ineTitular/);
    assert.match(asesorDetalle, /<CasaChecklistDocumental/);
    assert.match(asesorForm, /conyuge_aplica/);
    assert.match(admin, /<CasaChecklistDocumental/);
    assert.doesNotMatch(admin, /<CasaChecklistDocumental[^>]*editable/);
  });

  it("el acceso del asesor está reactivado sin desproteger sus documentos", () => {
    const reactivacion = src("supabase/migrations/20261105211000_reactivar_compra_casas_asesores.sql");
    assert.doesNotMatch(pausado, /Compra de casas no disponible/);
    assert.match(pausado, /\{children\}/);
    assert.match(reactivacion, /GRANT EXECUTE ON FUNCTION public\.casas_enviar\(uuid\) TO authenticated/);
    assert.match(reactivacion, /GRANT EXECUTE ON FUNCTION public\.casas_configurar_conyuge\(uuid,boolean\)/);
    assert.match(reactivacion, /GRANT SELECT,INSERT ON public\.casas_solicitudes TO authenticated/);
    assert.match(reactivacion, /p\.app_role='asesor'/);
    assert.match(reactivacion, /s\.estado='borrador'/);
  });
});
