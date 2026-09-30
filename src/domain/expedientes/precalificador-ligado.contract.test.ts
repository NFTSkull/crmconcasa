import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260930035000_anette_precalificador_ligado.sql"),
  "utf8",
);
const anetteDuplicateOverrideMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260930203500_anette_precal_permitir_nss_activo.sql",
  ),
  "utf8",
);
const readonlyResultsMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260930221000_precalificador_resultados_readonly.sql",
  ),
  "utf8",
);
const nombreRfcResultsMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260930230000_precalificador_nombre_rfc_readonly.sql",
  ),
  "utf8",
);
const dashboard = readFileSync(
  join(root, "src/components/asesor/PrecalificadorNssOnlyDashboard.tsx"),
  "utf8",
);
const asesorPage = readFileSync(join(root, "src/app/asesor/page.tsx"), "utf8");
const nuevaLayout = readFileSync(
  join(root, "src/app/asesor/nueva/layout.tsx"),
  "utf8",
);
const expedienteLayout = readFileSync(
  join(root, "src/app/asesor/expediente/[id]/layout.tsx"),
  "utf8",
);
const repo = readFileSync(
  join(root, "src/domain/expedientes/supabase.repo.ts"),
  "utf8",
);

describe("precalificador ligado NSS-only", () => {
  it("el expediente queda a nombre del titular y conserva procedencia", () => {
    assert.match(migration, /asesor_precalificadores_ligados/);
    assert.match(migration, /precalificador_origen_id/);
    assert.match(
      migration,
      /INSERT INTO public\.expedientes[\s\S]*v_target\.id[\s\S]*v_actor/,
    );
    assert.match(migration, /expedientes_guard_precalificador_nss_only/);
  });

  it("el usuario restringido solo usa la RPC NSS ligada", () => {
    assert.match(dashboard, /asesor_preparar_precalificacion_nss_only_ligada/);
    assert.match(dashboard, /Captura NSS y consulta únicamente tus resultados/);
    assert.doesNotMatch(dashboard, /DocumentDropzone/);
    assert.doesNotMatch(dashboard, /cliente_datos/);
    assert.match(asesorPage, /precalificador_nss_only/);
    assert.match(nuevaLayout, /PrecalificadorNssOnlyDashboard/);
  });

  it("solo Anette puede repetir un NSS activo pre-Mesa desde su precalificador ligado", () => {
    assert.match(
      anetteDuplicateOverrideMigration,
      /NOT public\.asesor_es_anette_externa\(v_target\.id\)[\s\S]*AND EXISTS/,
    );
    assert.match(anetteDuplicateOverrideMigration, /nss_bloqueado_en_mesa/);
    assert.doesNotMatch(
      anetteDuplicateOverrideMigration,
      /Anette ya tiene un expediente activo con este NSS/,
    );
  });

  it("Anette puede filtrar listado y KPIs por precalificador", () => {
    assert.match(asesorPage, /Origen de precalificación/);
    assert.match(asesorPage, /precalificadorOrigenId/);
    assert.match(repo, /p_precalificador_origen_id/);
    assert.match(repo, /asesor_inbox_counts_for_precalificador/);
    assert.match(migration, /p_precalificador_origen_id UUID DEFAULT NULL/);
  });

  it("el precalificador ve sus resultados con nombre y RFC Bansefi, sin acceso al expediente", () => {
    assert.match(dashboard, /asesor_precalificador_resultados/);
    assert.match(dashboard, /Mis precalificaciones/);
    assert.match(dashboard, /Nombre/);
    assert.match(dashboard, /RFC Bansefi/);
    assert.match(dashboard, /Monto aprobado/);
    assert.doesNotMatch(dashboard, /href=.*asesor\/expediente/);

    assert.match(readonlyResultsMigration, /e\.precalificador_origen_id = v_actor/);
    assert.match(
      readonlyResultsMigration,
      /e\.asesor_id = v_link\.asesor_titular_id/,
    );
    assert.match(readonlyResultsMigration, /'nss'/);
    assert.match(readonlyResultsMigration, /'resultado'/);
    assert.match(readonlyResultsMigration, /'monto_aprobado'/);
    assert.doesNotMatch(readonlyResultsMigration, /'expediente_id'/);
    assert.doesNotMatch(readonlyResultsMigration, /'cliente_nombre'/);
    assert.doesNotMatch(readonlyResultsMigration, /'telefono_cliente'/);

    assert.match(nombreRfcResultsMigration, /'nombre'/);
    assert.match(nombreRfcResultsMigration, /'rfc_infonavit'/);
    assert.match(nombreRfcResultsMigration, /ed\.rfc_infonavit/);
    assert.doesNotMatch(nombreRfcResultsMigration, /'expediente_id'/);
    assert.doesNotMatch(nombreRfcResultsMigration, /'telefono_cliente'/);
    assert.doesNotMatch(nombreRfcResultsMigration, /'registro_patronal_infonavit'/);
  });

  it("una URL directa de expediente regresa al precalificador a su dashboard", () => {
    assert.match(expedienteLayout, /asesor_precalificador_ligado_context/);
    assert.match(expedienteLayout, /router\.replace\("\/asesor"\)/);
  });
});
