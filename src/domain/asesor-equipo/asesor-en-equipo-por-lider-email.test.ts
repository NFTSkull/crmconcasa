import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EQUIPO_LIDER_EMAIL_SILVIA_REYES,
  parseAsesorEnEquipoPorLiderEmail,
  resolveClienteDatosCapturaVariant,
  resolveClienteDatosPerfilCaptura,
  shouldUseClienteDatosVistaSimplificada,
} from "./asesor-en-equipo-por-lider-email";

describe("asesor-en-equipo-por-lider-email FE", () => {
  it("fail-closed: solo true explícito activa simplificado", () => {
    assert.equal(shouldUseClienteDatosVistaSimplificada(true), true);
    assert.equal(shouldUseClienteDatosVistaSimplificada(false), false);
    assert.equal(shouldUseClienteDatosVistaSimplificada(null), false);
    assert.equal(shouldUseClienteDatosVistaSimplificada(undefined), false);
  });

  it("vista por actor; checklist/perfil por dueño (paquete externos)", () => {
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: true,
      }),
      "simplificado",
    );
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: false,
      }),
      "completo",
    );
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: true,
      }),
      "asesor_equipo_silvia_simplificado",
    );
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: false,
      }),
      "asesor_completo",
    );
    // Alias legacy sigue funcionando
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnEquipoSilviaConfirmado: true,
      }),
      "simplificado",
    );
  });

  it("parse RPC solo acepta true literal", () => {
    assert.equal(parseAsesorEnEquipoPorLiderEmail(true), true);
    assert.equal(parseAsesorEnEquipoPorLiderEmail(false), false);
    assert.equal(parseAsesorEnEquipoPorLiderEmail("true"), false);
    assert.equal(parseAsesorEnEquipoPorLiderEmail(1), false);
    assert.equal(parseAsesorEnEquipoPorLiderEmail(null), false);
  });

  it("email líder Silvia canónico", () => {
    assert.equal(EQUIPO_LIDER_EMAIL_SILVIA_REYES, "silvia.reyes@concasa.mx");
  });

  it("migración declara RPC genérica sin hardcode Silvia en SQL", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260903160000_asesor_en_equipo_por_lider_email.sql",
      ),
      "utf8",
    );
    assert.match(sql, /asesor_en_equipo_por_lider_email/);
    assert.match(sql, /p_leader_email/);
    assert.match(sql, /asesor_pertenece_equipo_activo/);
    assert.doesNotMatch(sql, /silvia\.reyes@concasa\.mx/i);
  });
});
