import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Admin resumen — distribución actual + actividad del periodo", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/admin/page.tsx"),
    "utf8",
  );
  const component = readFileSync(
    join(process.cwd(), "src/components/admin/AdminResumenEtapasActividad.tsx"),
    "utf8",
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260916234343_admin_resumen_movimientos_etapas.sql",
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

  it("la vista usa el mismo rango, asesor, estado y búsqueda del Resumen", () => {
    assert.match(page, /asesorId=\{asesorId \|\| null\}/);
    assert.match(page, /estado=\{estado\}/);
    assert.match(page, /buscar=\{buscarDebounced \|\| null\}/);
    assert.match(component, /p_from: bounds\.fromIso/);
    assert.match(component, /p_to_exclusive: bounds\.toExclusiveIso/);
  });

  it("separa ubicación actual de actividad histórica para no mezclar significados", () => {
    assert.match(component, /Distribución actual de los ingresos del periodo/);
    assert.match(component, /de los ingresos siguen aquí/);
    assert.match(component, /CRM hoy:/);
    assert.match(component, /<details/);
    assert.match(component, /Ver actividad del periodo por etapa/);
    assert.match(component, /Pasaron por aquí/);
    assert.match(component, /Venían de antes/);
    assert.match(component, /ETAPAS_VISUALES_OPERATIVAS\.map/);
    assert.match(component, /historyCompleteForPeriod/);
  });

  it("la RPC histórica sigue read-only y cuenta toda entrada a una etapa dentro del rango", () => {
    assert.match(migration, /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/);
    assert.match(migration, /t\.paso_visual_nuevo::INT AS paso_visual/);
    assert.match(migration, /t\.fecha_entrada >= p_from/);
    assert.match(migration, /t\.fecha_entrada < p_to_exclusive/);
    assert.match(migration, /m\.fecha_envio_mesa < p_from/);
    assert.match(migration, /admin_expedientes_snapshot_etapas/);
    assert.doesNotMatch(
      migration,
      /AND \(\s*t\.paso_visual_anterior IS NULL[\s\S]*t\.paso_visual_nuevo > t\.paso_visual_anterior/,
    );
    assert.doesNotMatch(migration, /\bUPDATE\b/i);
    assert.doesNotMatch(migration, /\bDELETE\b/i);
    assert.doesNotMatch(migration, /\bINSERT\b/i);
  });
});
