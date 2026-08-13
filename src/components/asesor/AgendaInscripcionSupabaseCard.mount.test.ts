/**
 * Mount contract P175 B2 / P177 — Inscripción vive en tab de agenda bio.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const root = process.cwd();

describe("P175 B2 / P177 mount contracts", () => {
  it("asesor expediente: Inscripción embebida en bio (sin gate standalone)", () => {
    const page = readFileSync(
      join(root, "src/app/asesor/expediente/[id]/page.tsx"),
      "utf8",
    );
    assert.doesNotMatch(page, /AsesorAgendaInscripcionSupabaseGate/);
    assert.match(page, /AsesorAgendaBiometricosSupabaseGate/);
    const bio = readFileSync(
      join(root, "src/components/asesor/AgendaBiometricosSupabaseCard.tsx"),
      "utf8",
    );
    assert.match(bio, /AgendaInscripcionSupabaseCard/);
    assert.match(bio, /"inscripcion"/);
    const card = readFileSync(
      join(root, "src/components/asesor/AgendaInscripcionSupabaseCard.tsx"),
      "utf8",
    );
    assert.match(card, /Cita de inscripción/);
    assert.match(card, /INSCRIPCION_FIXED_TIME_DISPLAY/);
    assert.doesNotMatch(card, /AgendaNotificacionSupabaseTab/);
  });

  it("Mesa detalle solicita inscripción; Citas filtra kind", () => {
    const detalle = readFileSync(
      join(root, "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx"),
      "utf8",
    );
    assert.match(detalle, /MesaSolicitarInscripcionSection/);
    const filters = readFileSync(
      join(root, "src/components/mesa-control/MesaAgendaCitasFilters.tsx"),
      "utf8",
    );
    assert.match(filters, /inscripcion/);
    const client = readFileSync(
      join(root, "src/components/mesa-control/MesaAgendaCitasClient.tsx"),
      "utf8",
    );
    assert.match(client, /kind === \"inscripcion\"/);
    assert.match(client, /inscripcionRepo/);
  });

  it("campana merge inscripción en asesor home", () => {
    const home = readFileSync(join(root, "src/app/asesor/page.tsx"), "utf8");
    assert.match(home, /mergeInscripcionBellNotifications/);
  });
});
