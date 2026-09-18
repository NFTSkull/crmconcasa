import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260918184710_infonavit_auto_docs_asesores_externos.sql",
  ),
  "utf8",
);
const solicitud = readFileSync(
  join(root, "src/components/asesor/AsesorSolicitudDocumentoSection.tsx"),
  "utf8",
);
const externoDatos = readFileSync(
  join(root, "src/components/asesor/ExpedienteClienteDatosFormSectionExterno.tsx"),
  "utf8",
);

describe("INFONAVIT automático — externos", () => {
  it("asesor interno o externo usa el mismo gate de visibilidad por expediente", () => {
    assert.match(migration, /v_role IS DISTINCT FROM 'asesor'/);
    assert.match(migration, /RETURN public\.can_see_expediente\(p_expediente_id\)/);
    assert.doesNotMatch(migration, /tipo_asesor_origen/);
    assert.doesNotMatch(migration, /IS DISTINCT FROM 'interno'/);
  });

  it("read model conserva Mesa externo y niega Editor", () => {
    assert.match(
      migration,
      /mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'/,
    );
    assert.match(migration, /IF v_role = 'asesor'/);
    assert.doesNotMatch(migration, /IF v_role = 'editor'/);
  });

  it("frontend asesor sigue usando gate backend fail-closed", () => {
    assert.match(solicitud, /asesor_puede_ver_infonavit_auto/);
    assert.match(solicitud, /setShowInfonavitAuto\(!rpcError && data === true\)/);
    assert.match(solicitud, /showInfonavitAuto\s*\?\s*\(/);
  });

  it("Datos Generales externos conservan autofill Infonavit visible", () => {
    assert.match(externoDatos, /applyClienteDatosInfonavitAutofill/);
    assert.match(externoDatos, /Datos de precalificación Infonavit/);
    assert.match(externoDatos, /RFC/);
    assert.match(externoDatos, /Registro patronal/);
    assert.match(externoDatos, /Empresa/);
  });

  it("cambio no toca generación, outbox, citas ni Storage write", () => {
    assert.doesNotMatch(migration, /enqueue_infonavit_pdf_submission\s*\(/);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.infonavit_pdf_outbox/i);
    assert.doesNotMatch(migration, /agenda_bookings/i);
    assert.doesNotMatch(migration, /storage\.objects/i);
  });
});
