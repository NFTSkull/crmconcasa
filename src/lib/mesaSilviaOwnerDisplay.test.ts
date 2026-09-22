import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Mesa — alias visual Equipo Silvia", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922233500_mesa_silvia_owner_display_alias.sql",
    ),
    "utf8",
  );
  const mesaPage = readFileSync(
    join(process.cwd(), "src/app/mesa-control/page.tsx"),
    "utf8",
  );
  const mesaDetalle = readFileSync(
    join(
      process.cwd(),
      "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx",
    ),
    "utf8",
  );

  it("la proyección Mesa aliasa solo el nombre visible de Silvia y su equipo", () => {
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.mesa_get_asesor_display_batch/,
    );
    assert.match(
      migration,
      /WHEN public\.asesor_es_equipo_silvia\(p\.id\) THEN 'SILVIA REYES'/,
    );
    assert.match(migration, /No altera datos ni métricas/);
  });

  it("la bandeja Mesa usa la proyección exclusiva de Mesa", () => {
    assert.match(mesaPage, /"mesa_get_asesor_display_batch"/);
  });

  it("el detalle Mesa aliasa al dueño pero conserva auditoría de agenda", () => {
    assert.match(
      mesaDetalle,
      /ownerProfileIdMesa[\s\S]*"mesa_get_asesor_display_batch"/,
    );
    assert.match(
      mesaDetalle,
      /activeNotificacionBooking[\s\S]*"get_asesor_display_batch"/,
    );
  });
});
