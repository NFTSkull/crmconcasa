/**
 * P177 — tercer tab Inscripción en agenda asesor (UI only).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("P177 agenda tabs Inscripción", () => {
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

  it("embed Inscripción card; no duplicate standalone mount", () => {
    assert.match(bio, /AgendaInscripcionSupabaseCard/);
    assert.match(bio, /embedded/);
    assert.doesNotMatch(page, /AsesorAgendaInscripcionSupabaseGate/);
    assert.match(page, /AsesorAgendaBiometricosSupabaseGate/);
  });

  it("sin requirement: estado No requerida sin CTA", () => {
    assert.match(insc, /inscripcion-no-requerida/);
    assert.match(insc, /No requerida/);
    assert.match(
      insc,
      /La cita de inscripción se habilita cuando Mesa/,
    );
    assert.match(insc, /embedded \? <InscripcionNoRequeridaState/);
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

  it("Notificación y Biométricos sin romper paneles", () => {
    assert.match(bio, /AgendaNotificacionSupabaseTab/);
    assert.match(bio, /agenda-tab-panel-notificacion/);
    assert.match(bio, /AdvisorAgendaSlotPicker/);
  });
});
