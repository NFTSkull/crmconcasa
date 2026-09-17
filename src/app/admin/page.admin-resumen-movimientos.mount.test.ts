import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Admin resumen — métricas claras + 10 etapas visibles", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/admin/page.tsx"),
    "utf8",
  );
  const component = readFileSync(
    join(process.cwd(), "src/components/admin/AdminResumenEtapasActividad.tsx"),
    "utf8",
  );
  const migrationOriginal = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260916234343_admin_resumen_movimientos_etapas.sql",
    ),
    "utf8",
  );
  const migrationAdmin10 = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260917015200_admin_resumen_pasos_admin_10.sql",
    ),
    "utf8",
  );

  it("monta una sola vista y reutiliza las fuentes read-only existentes", () => {
    assert.doesNotMatch(page, /title="Etapas del periodo"/);
    assert.match(page, /<AdminResumenEtapasActividad/);
    assert.match(page, /bounds=\{bounds\}/);
    assert.match(page, /periodoLabel=\{periodoLabel\}/);
    assert.match(page, /cohortBuckets=\{byEtapa\}/);
    assert.match(page, /cohortTotal=\{snapshotTotal\}/);
    assert.match(page, /onStagePress=\{onEtapaCardPress\}/);
  });

  it("KPIs generales ignoran etapa y el detalle de etapa vive abajo", () => {
    assert.match(page, /repo\.getSummary\(periodStageFiltersBase\)/);
    assert.doesNotMatch(page, /repo\.getSummary\(filtersBase\)/);
    assert.match(page, /title="Resumen del periodo"/);
    assert.match(page, /Estas cinco métricas muestran el periodo completo/);
    assert.match(component, /Detalle de etapa/);
  });

  it("la vista usa el mismo rango, asesor, estado y búsqueda del Resumen", () => {
    assert.match(page, /asesorId=\{asesorId \|\| null\}/);
    assert.match(page, /estado=\{estado\}/);
    assert.match(page, /buscar=\{buscarDebounced \|\| null\}/);
    assert.match(component, /p_from: bounds\.fromIso/);
    assert.match(component, /p_to_exclusive: bounds\.toExclusiveIso/);
  });

  it("separa ubicación actual de movimientos históricos", () => {
    assert.match(component, /Distribución actual de los ingresos del periodo/);
    assert.match(component, /CRM hoy:/);
    assert.match(component, /<details/);
    assert.match(component, /Ver movimientos del periodo por etapa/);
    assert.match(component, /Llegaron a esta etapa/);
    assert.match(component, /Ya venían de antes/);
    assert.match(component, /ADMIN_VISIBLE_STAGES\.map/);
    assert.match(component, /historyCompleteForPeriod/);
  });

  it("RPC original sigue read-only y conserva salida canónica", () => {
    assert.match(migrationOriginal, /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/);
    assert.match(migrationOriginal, /t\.paso_visual_nuevo::INT AS paso_visual/);
    assert.match(migrationOriginal, /t\.fecha_entrada >= p_from/);
    assert.match(migrationOriginal, /t\.fecha_entrada < p_to_exclusive/);
    assert.match(migrationOriginal, /admin_expedientes_snapshot_etapas/);
    assert.doesNotMatch(migrationOriginal, /\bUPDATE\b/i);
    assert.doesNotMatch(migrationOriginal, /\bDELETE\b/i);
    assert.doesNotMatch(migrationOriginal, /\bINSERT\b/i);
  });

  it("migración nueva agrega 10 pasos Admin sin escrituras", () => {
    assert.match(migrationAdmin10, /'by_paso_admin'/);
    assert.match(migrationAdmin10, /'admin_steps', 10/);
    assert.match(migrationAdmin10, /generate_series\(1, 10\)/);
    assert.match(migrationAdmin10, /t\.paso_visual_nuevo IN \(8, 9\) THEN 8/);
    assert.match(migrationAdmin10, /t\.paso_visual_nuevo = 10 THEN 9/);
    assert.match(migrationAdmin10, /t\.paso_visual_nuevo = 11 THEN 10/);
    assert.match(migrationAdmin10, /SELECT DISTINCT\s+t\.expediente_id/);
    assert.match(migrationAdmin10, /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/);
    assert.doesNotMatch(migrationAdmin10, /\bUPDATE\b/i);
    assert.doesNotMatch(migrationAdmin10, /\bDELETE\b/i);
    assert.doesNotMatch(migrationAdmin10, /\bINSERT\b/i);
  });
});
