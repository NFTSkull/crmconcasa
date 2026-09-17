import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Admin resumen — flujo unificado del periodo y foto actual", () => {
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

  it("monta una sola vista y reutiliza el desglose del periodo dentro del mismo bloque", () => {
    assert.doesNotMatch(page, /title="Etapas del periodo"/);
    assert.match(page, /<AdminResumenEtapasActividad/);
    assert.match(page, /bounds=\{bounds\}/);
    assert.match(page, /periodoLabel=\{periodoLabel\}/);
    assert.match(page, /selectedInternalStages=\{etapaActualesSeleccionadas\}/);
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

  it("presenta actividad, permanencia de la cohorte y foto actual en cada paso", () => {
    assert.match(component, /Flujo de expedientes/);
    assert.match(component, /Pasaron aquí/);
    assert.match(component, /Siguen aquí/);
    assert.match(component, /Total hoy/);
    assert.match(component, /venían de antes/);
    assert.match(component, /ingresaron en el rango/);
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
