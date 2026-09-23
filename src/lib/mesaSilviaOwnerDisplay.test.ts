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
  const expedientesRepo = readFileSync(
    join(process.cwd(), "src/domain/expedientes/supabase.repo.ts"),
    "utf8",
  );
  const mesaOwnerDisplay = readFileSync(
    join(process.cwd(), "src/lib/mesaOwnerDisplay.ts"),
    "utf8",
  );
  const agendaRepo = readFileSync(
    join(process.cwd(), "src/domain/agenda-calendar/mesa.repo.ts"),
    "utf8",
  );
  const hojaRepo = readFileSync(
    join(process.cwd(), "src/domain/agenda-hoja-crm/mesa.repo.ts"),
    "utf8",
  );
  const cambiosRepo = readFileSync(
    join(process.cwd(), "src/domain/expedientes/mesa-asesor-cambios.ts"),
    "utf8",
  );
  const allSurfacesMigration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260923154500_mesa_owner_display_all_surfaces.sql",
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

  it("la bandeja Mesa aplica el alias solo al dueño del expediente", () => {
    assert.match(
      expedientesRepo,
      /fetchMesaOwnerDisplayMap[\s\S]*"mesa_get_asesor_display_batch"/,
    );
    assert.match(
      expedientesRepo,
      /fetchExpedientesListForMesaControlPaginated[\s\S]*fetchMesaOwnerDisplayMap/,
    );
  });

  it("la auditoría de agenda conserva el nombre real del actor", () => {
    assert.match(mesaPage, /"get_asesor_display_batch"/);
    assert.doesNotMatch(mesaPage, /"mesa_get_asesor_display_batch"/);
  });

  it("los listados generales conservan el nombre real del asesor", () => {
    assert.match(
      expedientesRepo,
      /async function fetchExpedientesList\(options[\s\S]*fetchAsesorDisplayMap/,
    );
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

  it("todas las superficies Mesa reutilizan el alias del dueño", () => {
    assert.match(
      allSurfacesMigration,
      /mesa_get_expediente_owner_display_batch[\s\S]*mesa_get_asesor_display_batch/,
    );
    assert.match(
      mesaOwnerDisplay,
      /fetchMesaOwnerDisplayByAsesorIds[\s\S]*mesa_get_asesor_display_batch/,
    );
    assert.match(
      mesaOwnerDisplay,
      /fetchMesaOwnerDisplayByExpedienteIds[\s\S]*mesa_get_expediente_owner_display_batch/,
    );
    assert.match(
      agendaRepo,
      /fetchMesaOwnerDisplayByAsesorIds[\s\S]*fullName: display\.fullName/,
    );
    assert.match(
      hojaRepo,
      /fetchMesaOwnerDisplayByExpedienteIds[\s\S]*asesorNombre: display\.fullName/,
    );
    assert.match(
      cambiosRepo,
      /fetchMesaOwnerDisplayByExpedienteIds[\s\S]*asesorNombre: display\.fullName/,
    );
  });
});
