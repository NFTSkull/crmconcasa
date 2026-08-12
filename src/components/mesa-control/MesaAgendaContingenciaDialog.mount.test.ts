import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("P172 B2 MesaAgendaContingenciaDialog montaje", () => {
  const dialog = readFileSync(
    join(
      process.cwd(),
      "src/components/mesa-control/MesaAgendaContingenciaDialog.tsx",
    ),
    "utf8",
  );
  const client = readFileSync(
    join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasClient.tsx"),
    "utf8",
  );
  const summary = readFileSync(
    join(
      process.cwd(),
      "src/components/mesa-control/MesaAgendaContingenciaSummaryPanel.tsx",
    ),
    "utf8",
  );
  const parts = readFileSync(
    join(
      process.cwd(),
      "src/components/mesa-control/MesaAgendaCitasEntryParts.tsx",
    ),
    "utf8",
  );
  const week = readFileSync(
    join(
      process.cwd(),
      "src/components/mesa-control/MesaAgendaCitasWeekView.tsx",
    ),
    "utf8",
  );

  it("botón Mesa amber separado + label Contingencia", () => {
    assert.match(client, /mesa-contingencia-button/);
    assert.match(client, /Contingencia · Solicitar reagenda/);
    assert.match(client, /border-amber-300 bg-amber-50/);
    assert.match(client, /canDeclareAgendaContingencia/);
    assert.match(client, /canDeclareContingenciaOnView/);
    assert.doesNotMatch(
      client,
      /Contingencia[\s\S]{0,80}selectedBookingIds/,
    );
  });

  it("dialog: kinds independientes, sede, motivo, preview RPC", () => {
    assert.match(dialog, /Solicitar reagenda extraordinaria/);
    assert.match(dialog, /Biométricos/);
    assert.match(dialog, /Firmas/);
    assert.match(dialog, /previewContingencia/);
    assert.match(dialog, /declararContingencia/);
    assert.match(dialog, /location_id: locationId/);
    assert.match(dialog, /sede === "todas" \? null/);
    assert.match(
      dialog,
      /Falla general del sistema, cierre de CESI, contingencia externa/,
    );
    assert.match(dialog, /NO cancela ni modifica las citas originales/);
    assert.match(dialog, /kindsToDeclare/);
    assert.match(dialog, /for \(const kind of kindsToDeclare\)/);
    assert.match(dialog, /busyRef/);
    assert.match(dialog, /Generando solicitudes…/);
    assert.doesNotMatch(dialog, /kind:\s*["']ambos["']/);
    assert.doesNotMatch(dialog, /selectedBookingIds/);
    assert.doesNotMatch(dialog, /visibleEntries/);
  });

  it("ambos kinds → loop secuencial (2 declaraciones posibles)", () => {
    assert.match(dialog, /if \(bio\) ks\.push\("biometricos"\)/);
    assert.match(dialog, /if \(firmas\) ks\.push\("firmas"\)/);
    assert.match(dialog, /solicitudes creadas/);
    assert.match(dialog, /partial|no se pudo|AgendaContingenciaError/i);
  });

  it("0 affected no declara ese kind; confirm gated", () => {
    assert.match(dialog, /\(p\?\.affected_count \?\? 0\) > 0/);
    assert.match(dialog, /kindsToDeclare\.length > 0/);
    assert.match(dialog, /Sin citas afectadas/);
  });

  it("summary panel métricas independientes + NO HUBO", () => {
    assert.match(summary, /No hubo citas/);
    assert.match(summary, /Afectadas/);
    assert.match(summary, /Reagendadas/);
    assert.match(summary, /Pendientes/);
    assert.match(summary, /headers\.map/);
    assert.match(summary, /Todas las citas fueron reagendadas/);
  });

  it("badge CONTINGENCIA + acciones bloqueadas helper B1.1", () => {
    assert.match(parts, /CONTINGENCIA/);
    assert.match(parts, /contingencia-badge/);
    assert.match(parts, /No hubo cita — reagenda extraordinaria solicitada/);
    assert.match(client, /contingencyOriginalBlockedActions/);
    assert.match(client, /CONTINGENCIA · NO HUBO CITA/);
    assert.match(client, /listMesaContingenciaItems/);
    assert.match(client, /listMesaAgendaContingencias/);
  });

  it("WeekView propaga contingencyByBookingId a DayView", () => {
    assert.match(week, /contingencyByBookingId=\{contingencyByBookingId\}/);
  });

  it("post-confirm refetch citas + contingencias; no cancel visual", () => {
    assert.match(client, /void loadEntries\(\);\s*void loadContingencias\(\)/);
    assert.doesNotMatch(client, /status:\s*["']cancelled["'].*contingen/i);
  });
});
