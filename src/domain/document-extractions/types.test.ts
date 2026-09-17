import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DOCUMENT_EXTRACTION_DEFAULT_PROVIDER,
  DOCUMENT_EXTRACTION_DEFAULT_PROVIDER_VERSION,
  DOCUMENT_EXTRACTION_FUENTES_VERDAD,
  DOCUMENT_EXTRACTION_INE_FIELD_CANDIDATES,
  DOCUMENT_EXTRACTION_TIPOS_PERMITIDOS,
  DOCUMENT_EXTRACTION_VAULT_ENQUEUE_ENABLED,
  fixturePayloadNormalizedShadow,
  isDocumentExtractionTipoPermitido,
} from "./types";

const ROOT = join(__dirname, "../../..");
const MIG = join(
  ROOT,
  "supabase/migrations/20260917210000_document_extractions_shadow_p2.sql",
);
const REG_MIG_GLOB_HINT = "register_expediente_documento";

function migrationSql(): string {
  assert.equal(existsSync(MIG), true, "migration P2 debe existir");
  return readFileSync(MIG, "utf8");
}

describe("document-extractions P2 — allowlist + contrato", () => {
  it("allowlist exacta de 4 tipos", () => {
    assert.deepEqual([...DOCUMENT_EXTRACTION_TIPOS_PERMITIDOS], [
      "cliente_ine_frente",
      "cliente_ine_reverso",
      "cliente_comprobante_domicilio",
      "cliente_estado_cuenta",
    ]);
    assert.equal(isDocumentExtractionTipoPermitido("cliente_ine_frente"), true);
    assert.equal(isDocumentExtractionTipoPermitido("cliente_acta_nacimiento"), false);
    assert.equal(isDocumentExtractionTipoPermitido(null), false);
  });

  it("fuentes de verdad documentadas (INE/CFE/CLABE)", () => {
    assert.ok(DOCUMENT_EXTRACTION_FUENTES_VERDAD.identidad.includes("cliente_ine_frente"));
    assert.ok(DOCUMENT_EXTRACTION_FUENTES_VERDAD.vivienda.includes("cliente_comprobante_domicilio"));
    assert.ok(DOCUMENT_EXTRACTION_FUENTES_VERDAD.clabe.includes("cliente_estado_cuenta"));
  });

  it("T7 número identificación es candidato sin autofill", () => {
    assert.ok(
      (DOCUMENT_EXTRACTION_INE_FIELD_CANDIDATES as readonly string[]).includes(
        "identificacion.numero",
      ),
    );
  });

  it("fixture payload_normalized sin PII real", () => {
    const p = fixturePayloadNormalizedShadow({
      sourceDocumentType: "cliente_ine_frente",
      sourceDocumentId: "00000000-0000-4000-8000-000000000001",
      documentVersion: 1,
    });
    const raw = JSON.stringify(p);
    assert.equal(raw.includes("NOMBRE_SINTETICO"), true);
    assert.equal(/[A-Z]{4}\d{6}[A-Z0-9]{8}/.test(raw), false); // no CURP real-like
    assert.equal(/\d{18}/.test(raw), false); // no CLABE
  });

  it("provider shadow p2 por defecto", () => {
    assert.equal(DOCUMENT_EXTRACTION_DEFAULT_PROVIDER, "shadow");
    assert.equal(DOCUMENT_EXTRACTION_DEFAULT_PROVIDER_VERSION, "p2");
  });
});

describe("document-extractions P2 — contrato migration estática", () => {
  it("tablas + FORCE RLS + revoke authenticated", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.document_extractions/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.document_extraction_jobs/);
    assert.match(sql, /FORCE ROW LEVEL SECURITY/);
    assert.match(
      sql,
      /REVOKE ALL ON TABLE public\.document_extractions[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    assert.match(
      sql,
      /REVOKE ALL ON TABLE public\.document_extraction_jobs[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
  });

  it("payload_raw presente; enqueue service_role only", () => {
    const sql = migrationSql();
    assert.match(sql, /payload_raw JSONB/);
    assert.match(sql, /payload_normalized JSONB/);
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION public\.enqueue_document_extraction[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.enqueue_document_extraction[\s\S]*TO service_role/,
    );
  });

  it("idempotencia UNIQUE (documento_id, provider, provider_version)", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /UNIQUE \(documento_id, provider, provider_version\)/,
    );
    // document_version denormalizado; id ya representa versión de archivo
    assert.match(sql, /document_version INTEGER NOT NULL/);
  });

  it("feature flag Vault DEFAULT OFF (fail-closed)", () => {
    const sql = migrationSql();
    assert.match(sql, new RegExp(DOCUMENT_EXTRACTION_VAULT_ENQUEUE_ENABLED));
    assert.match(sql, /document_extraction_feature_enabled/);
    assert.match(sql, /RETURN false/);
    assert.equal(sql.includes("p189_infonavit_enqueue_enabled"), false);
  });

  it("stale/versionado helper presente", () => {
    const sql = migrationSql();
    assert.match(sql, /document_extraction_mark_stale_superseded/);
    assert.match(sql, /superseded_by_newer_document/);
    assert.match(sql, /stale_at/);
    assert.match(sql, /stale_reason/);
  });

  it("allowlist SQL exacta de 4 tipos", () => {
    const sql = migrationSql();
    for (const t of DOCUMENT_EXTRACTION_TIPOS_PERMITIDOS) {
      assert.match(sql, new RegExp(`'${t}'`));
    }
    assert.equal(sql.includes("cliente_acta_nacimiento"), false);
  });

  it("NO cablea upload productivo; NO OCR/provider/backfill", () => {
    const sql = migrationSql();
    assert.equal(sql.includes(`CREATE OR REPLACE FUNCTION public.${REG_MIG_GLOB_HINT}`), false);
    assert.match(sql, /NO cableado a register_expediente_documento/);
    // Mencionar "SIN OCR" en comentarios es OK; no debe haber llamadas a providers.
    assert.equal(/\b(openai|anthropic|documentai|vision\.googleapis)\b/i.test(sql), false);
    assert.equal(/\bhttp_post\b/i.test(sql), false);
    assert.equal(/\bINSERT\s+INTO\s+public\.(expedientes|cliente_datos)\b/i.test(sql), false);
    assert.equal(
      /UPDATE\s+public\.(expedientes|cliente_datos|expediente_documentos)\b/i.test(sql),
      false,
    );
    assert.equal(
      /DELETE\s+FROM\s+public\.(expedientes|cliente_datos|expediente_documentos)\b/i.test(sql),
      false,
    );
    assert.match(sql, /NO backfill|Sin backfill|NO BACKFILL/i);
  });

  it("NO toca P189 outbox/snapshot ni agenda/Sheets", () => {
    const sql = migrationSql();
    assert.equal(sql.includes("infonavit_pdf_outbox"), false);
    assert.equal(sql.includes("expediente_infonavit_submission_snapshots"), false);
    assert.equal(sql.includes("agenda_sheet"), false);
    assert.equal(sql.includes("agenda_bookings"), false);
    assert.equal(sql.includes("cupos"), false);
  });

  it("integridad FK + align triggers (documento + extraction↔job)", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /documento_id UUID NOT NULL REFERENCES public\.expediente_documentos\(id\)/,
    );
    assert.match(sql, /trg_document_extraction_row_align_documento/);
    assert.match(sql, /trg_document_extraction_job_align_extraction/);
    assert.match(sql, /extraction_id desalineado/);
    assert.match(sql, /SET search_path = public/);
  });

  it("SQL test: UUIDs válidos + TRANSACTION/ROLLBACK", () => {
    const sqlPath = join(
      ROOT,
      "supabase/tests/rpc_document_extractions_shadow_p2.sql",
    );
    const sql = readFileSync(sqlPath, "utf8");
    assert.match(sql, /^BEGIN;/m);
    assert.match(sql, /^ROLLBACK;/m);
    assert.equal(sql.includes("a2dx0000"), false);
    const uuidLits = [...sql.matchAll(/'([0-9a-fA-FxX-]{36})'/g)].map((m) => m[1]);
    assert.ok(uuidLits.length >= 5, "debe haber fixtures UUID");
    for (const u of uuidLits) {
      assert.match(
        u,
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        `UUID inválido: ${u}`,
      );
    }
    assert.match(sql, /extraction_id desalineado/);
    assert.match(sql, /job otro documento rechazado/);
    assert.match(sql, /job provider distinto rechazado/);
    assert.match(sql, /job provider_version distinta rechazado/);
  });

  it("docs + SQL test existen", () => {
    assert.equal(
      existsSync(join(ROOT, "docs/DOCUMENT_EXTRACTIONS.md")),
      true,
    );
    assert.equal(
      existsSync(
        join(ROOT, "supabase/tests/rpc_document_extractions_shadow_p2.sql"),
      ),
      true,
    );
  });
});
