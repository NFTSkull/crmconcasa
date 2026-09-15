import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("NSS-only Anette + Equipo Silvia en /asesor/nueva", () => {
  const layout = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/layout.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/anette-nss-only-page.tsx"),
    "utf8",
  );
  const general = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/page.tsx"),
    "utf8",
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260915064500_silvia_team_nss_only_precal.sql",
    ),
    "utf8",
  );
  const editorCell = readFileSync(
    join(
      process.cwd(),
      "src/components/editor/EditorClienteNombreCell.tsx",
    ),
    "utf8",
  );

  it("mantiene Anette y resuelve Silvia/equipo desde Cloud antes de montar el formulario", () => {
    assert.match(layout, /isAnetteNssOnlyEmail\(currentUser\.email\)/);
    assert.match(layout, /asesor_precal_nss_only_habilitado/);
    assert.match(layout, /nssOnlyEnabled === null/);
    assert.match(layout, /return <AnetteNssOnlyPrecalPage \/>/);
    assert.match(layout, /return <>\{children\}<\/>/);
  });

  it("la vista NSS-only captura únicamente NSS", () => {
    assert.match(page, /name="nss"/);
    assert.doesNotMatch(page, /name="cliente_nombre"/);
    assert.doesNotMatch(page, /name="telefono_cliente"/);
    assert.doesNotMatch(page, /name="direccion_opcional"/);
    assert.doesNotMatch(page, /name="programa"/);
  });

  it("usa wrapper backend acotado y dispara auto-precal/reprecal", () => {
    assert.match(page, /asesor_preparar_precalificacion_nss_only/);
    assert.match(page, /resolveBearerAccessToken/);
    assert.match(page, /fireAutoPrecalificarAck/);
    assert.match(page, /fireAutoReprecalificarAck/);
    assert.match(migration, /asesor_es_anette_externa\(v_actor_id\)/);
    assert.match(migration, /asesor_es_equipo_silvia\(v_actor_id\)/);
    assert.match(migration, /asesor_preparar_precalificacion_externo_nss/);
    const ack = readFileSync(
      join(process.cwd(), "src/domain/expedientes/fire-auto-precalificar-ack.ts"),
      "utf8",
    );
    assert.match(ack, /\/auto-precalificar/);
  });

  it("habilita autofill de nombre para Silvia/equipo y conserva respaldo manual del Editor", () => {
    assert.match(migration, /autofill_nombre_infonavit/);
    assert.match(migration, /asesor_es_equipo_silvia\(p\.id\)/);
    assert.match(editorCell, /POR CAPTURAR/);
    assert.match(editorCell, /editor_fill_nombre_infonavit/);
  });

  it("no reemplaza ni modifica el contrato visual general para otros asesores", () => {
    assert.match(general, /name="cliente_nombre"/);
    assert.match(general, /name="telefono_cliente"/);
    assert.match(general, /name="direccion_opcional"/);
    assert.match(general, /name="programa"/);
  });
});
