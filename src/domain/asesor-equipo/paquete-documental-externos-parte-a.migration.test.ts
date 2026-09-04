/**
 * Contrato estático Parte A (mig 20260904120000).
 * No ejecuta SQL; valida que el archivo versionado existe y cumple el contrato
 * que esperan los wrappers 20260904214500 ya en main.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIG = join(
  process.cwd(),
  "supabase/migrations/20260904120000_paquete_documental_externos_silvia_orlando.sql",
);
const WRAPPERS = join(
  process.cwd(),
  "supabase/migrations/20260904214500_asesor_documentos_obligatorios_envio_wrappers.sql",
);

const ENVIO_EXTERNOS_7 = [
  "cliente_ine_frente",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
  "cliente_solicitud_credito",
  "cliente_lista_nominal",
  "cliente_bajo_protesta",
  "cliente_presupuesto",
] as const;

describe("Parte A mig 20260904120000 — contrato estático", () => {
  it("archivo existe y wrappers vienen después en el timeline", () => {
    assert.equal(existsSync(MIG), true);
    assert.equal(existsSync(WRAPPERS), true);
    assert.ok("20260904120000" < "20260904214500");
  });

  it("crea helpers que wrappers consumen", () => {
    const sql = readFileSync(MIG, "utf8");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.asesor_paquete_documental_externos\s*\(\s*p_asesor_id uuid\s*\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.integration_doc_tipos_asesor_envio_para\s*\(\s*p_asesor_id uuid\s*\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.integration_doc_tipos_asesor_upload_para\s*\(\s*p_asesor_id uuid\s*\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.integration_doc_tipos_requeridos_para_expediente\s*\(\s*p_expediente_id uuid\s*\)/);

    const wrap = readFileSync(WRAPPERS, "utf8");
    assert.match(wrap, /integration_doc_tipos_asesor_envio_para/);
    assert.match(wrap, /asesor_paquete_documental_externos/);
  });

  it("membresía Silvia U Orlando; envío externos = 7 sin CURP ni Acta ni ine_reverso", () => {
    const sql = readFileSync(MIG, "utf8");
    assert.match(sql, /silvia\.reyes@concasa\.mx/);
    assert.match(sql, /orlando\.solis@concasa\.mx/);

    const envioFn = sql.split("CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_envio_para")[1]
      .split("CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload_para")[0];
    for (const t of ENVIO_EXTERNOS_7) {
      assert.match(envioFn, new RegExp(`'${t}'`));
    }
    assert.doesNotMatch(envioFn, /cliente_constancia_curp/);
    assert.doesNotMatch(envioFn, /cliente_acta_nacimiento_digital/);
    assert.doesNotMatch(envioFn, /cliente_ine_reverso/);

    const uploadFn = sql.split("CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload_para")[1]
      .split("CREATE OR REPLACE FUNCTION public.integration_doc_tipos_requeridos_para_expediente")[0];
    // Contrato original: externos = SOLO envio_para (7), sin opcionales extra.
    assert.match(uploadFn, /SOLO los 7 de envio_para|solo envio_para/i);
    assert.doesNotMatch(uploadFn, /cliente_acta_nacimiento_digital/);
  });

  it("SECURITY DEFINER + search_path + REVOKE PUBLIC en helpers clave; sin GRANT anon", () => {
    const sql = readFileSync(MIG, "utf8");
    for (const name of [
      "asesor_paquete_documental_externos",
      "integration_doc_tipos_asesor_envio_para",
      "integration_doc_tipos_asesor_upload_para",
    ]) {
      const block = sql.split(`CREATE OR REPLACE FUNCTION public.${name}`)[1].slice(0, 2500);
      assert.match(block, /SECURITY DEFINER/);
      assert.match(block, /search_path\s*=\s*public/);
      assert.match(block, /REVOKE ALL ON FUNCTION public\./);
      assert.doesNotMatch(block, /GRANT EXECUTE[^\n]*TO anon/);
      assert.doesNotMatch(block, /GRANT EXECUTE[^\n]*TO PUBLIC/);
    }
  });
});
