/**
 * P177/P178 — tab Inscripción + self-service elegible.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("P177/P178 agenda tabs Inscripción", () => {
  const bio = readFileSync(
    join(root, "src/components/asesor/AgendaBiometricosSupabaseCard.tsx"),
    "utf8",
  );
  const insc = readFileSync(
    join(root, "src/components/asesor/AgendaInscripcionSupabaseCard.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(root, "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );
  const repo = readFileSync(
    join(root, "src/domain/agenda-inscripcion/supabase.repo.ts"),
    "utf8",
  );
  const notif = readFileSync(
    join(root, "src/components/asesor/AgendaNotificacionSupabaseTab.tsx"),
    "utf8",
  );
  const notifConstants = readFileSync(
    join(root, "src/domain/agenda-biometricos/notificacion-constants.ts"),
    "utf8",
  );
  const sharedDriveMigration = readFileSync(
    join(
      root,
      "supabase/migrations/20260930183000_notificacion_comparte_inscripcion_drive.sql",
    ),
    "utf8",
  );

  it("tabs visibles: Biométricos | Notificación | Inscripción", () => {
    assert.match(bio, /AgendaEtapa3Tab = "biometricos" \| "notificacion" \| "inscripcion"/);
    assert.match(bio, /label: "Biométricos"/);
    assert.match(bio, /label: "Notificación"/);
    assert.match(bio, /label: "Inscripción"/);
    assert.match(bio, /data-testid="agenda-asesor-tabs"/);
  });

  it("default biometricos; copy Agendar cita", () => {
    assert.match(bio, /useState<AgendaEtapa3Tab>\("biometricos"\)/);
    assert.match(bio, /"Agendar cita"/);
    assert.match(
      bio,
      /Consulta horarios y cupos disponibles sincronizados con la agenda/,
    );
  });

  it("embed Inscripción en bio; standalone solo para etapas 6–7", () => {
    assert.match(bio, /AgendaInscripcionSupabaseCard/);
    assert.match(bio, /embedded/);
    assert.match(page, /AsesorAgendaInscripcionSupabaseGate/);
    assert.match(page, /operativo\.etapaActual >= 6/);
    assert.match(page, /operativo\.etapaActual <= 7/);
    assert.match(page, /AsesorAgendaBiometricosSupabaseGate/);
  });

  it("P178 eligible: Disponible + Agendar; ineligible sin CTA", () => {
    assert.match(insc, /inscripcion-badge-disponible/);
    assert.match(insc, /Disponible/);
    assert.match(
      insc,
      /Si el cliente necesita regresar para concluir/,
    );
    assert.match(insc, /inscripcion-no-disponible/);
    assert.match(insc, /No disponible todavía/);
    assert.match(
      insc,
      /La cita de inscripción se habilita después de que el cliente haya/,
    );
    assert.doesNotMatch(insc, /No requerida/);
    assert.match(insc, /getAsesorEligibility/);
    assert.match(insc, /isInscripcionSelfServiceVisible/);
  });

  it("pending/booked/rebook CTAs + Monterrey-only + 11:00", () => {
    assert.match(insc, /Agendar inscripción/);
    assert.match(insc, /Reagendar inscripción/);
    assert.match(insc, /Cancelar cita/);
    assert.match(insc, /INSCRIPCION_SEDE = "monterrey"/);
    assert.doesNotMatch(insc, /Apodaca/);
    assert.match(insc, /INSCRIPCION_FIXED_TIME_DISPLAY/);
    assert.match(insc, /locationId: INSCRIPCION_SEDE/);
  });

  it("no crea requirement desde frontend; solo book RPC", () => {
    assert.doesNotMatch(insc, /mesaSolicitar/);
    assert.doesNotMatch(insc, /require_from_sheet/);
    assert.doesNotMatch(insc, /agenda_inscripcion_require/);
    assert.match(insc, /repo\.book\(/);
    assert.match(repo, /book_inscripcion_extraordinaria/);
    assert.match(repo, /agenda_inscripcion_asesor_eligibility/);
    assert.doesNotMatch(repo, /INSERT INTO.*agenda_inscripcion_requerimientos/);
  });

  it("Notificación y Biométricos sin romper paneles", () => {
    assert.match(bio, /AgendaNotificacionSupabaseTab/);
    assert.match(bio, /agenda-tab-panel-notificacion/);
    assert.match(bio, /AdvisorAgendaSlotPicker/);
  });

  it("Notificación comparte el pool físico de Inscripción en Drive", () => {
    assert.doesNotMatch(
      notif,
      /El expediente permanece en etapa 3 hasta que Mesa apruebe la notificación/,
    );
    assert.match(notifConstants, /comparte el mismo cupo de Inscripción en Drive/);
    assert.doesNotMatch(notifConstants, /cupo ilimitado/);

    assert.match(
      sharedDriveMigration,
      /NEW\.kind::TEXT <> 'notificacion'/,
    );
    assert.match(
      sharedDriveMigration,
      /i\.kind = 'inscripcion'/,
    );
    assert.match(
      sharedDriveMigration,
      /i\.sheet_slot_time = TIME '11:00'/,
    );
    assert.match(
      sharedDriveMigration,
      /'kind', 'inscripcion'/,
    );
    assert.match(
      sharedDriveMigration,
      /'booking_kind', 'notificacion'/,
    );
  });
});
