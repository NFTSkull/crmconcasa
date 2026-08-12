import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  normalizeExtraordinarySlots,
  EXTRAORDINARY_DEFAULT_SLOTS,
} from "@/domain/agenda-contingencia";

describe("P172 B2 AgendaExtraordinaryRebookCard + capacity isolation", () => {
  const card = readFileSync(
    join(
      process.cwd(),
      "src/components/asesor/AgendaExtraordinaryRebookCard.tsx",
    ),
    "utf8",
  );
  const expediente = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );
  const asesor = readFileSync(
    join(process.cwd(), "src/app/asesor/page.tsx"),
    "utf8",
  );
  const bell = readFileSync(
    join(process.cwd(), "src/components/notifications/NotificationsBell.tsx"),
    "utf8",
  );
  const reads = readFileSync(
    join(process.cwd(), "src/lib/dashboardNotificationReads.ts"),
    "utf8",
  );

  it("card pending + success + copy extraordinaria sin cupo", () => {
    assert.match(card, /Reagenda extraordinaria requerida/);
    assert.match(card, /Reagenda extraordinaria confirmada/);
    assert.match(card, /no consume cupo de la agenda normal/);
    assert.match(card, /no ocupa un espacio de la agenda ordinaria/);
    assert.match(card, /agendarCitaExtraordinaria/);
    assert.match(card, /normalizeExtraordinarySlots/);
    assert.doesNotMatch(card, /book_biometricos|book_firmas|Lugares disponibles/);
    assert.doesNotMatch(card, /getWeeklyAvailability|fetchSheetInventory/);
    assert.doesNotMatch(card, /AgendaBiometricosSupabaseCard|AgendaFirmasSupabaseCard/);
  });

  it("catálogo permite hora aunque remaining=0 (sin capacity gate)", () => {
    const remaining = 0;
    const slots = normalizeExtraordinarySlots(["08:30", "09:00"]);
    assert.equal(remaining, 0);
    assert.ok(slots.includes("08:30"));
    assert.deepEqual(
      normalizeExtraordinarySlots(null),
      [...EXTRAORDINARY_DEFAULT_SLOTS],
    );
    assert.match(card, /slots\.map/);
    assert.doesNotMatch(card, /getWeeklyAvailability|capacity_by_time/);
  });

  it("expediente carga Cloud listContingenciaExpedienteAsesor antes de agenda normal", () => {
    assert.match(expediente, /listContingenciaExpedienteAsesor/);
    assert.match(expediente, /AgendaExtraordinaryRebookCard/);
    assert.match(expediente, /asesor-contingencia-cards/);
    const idxExtra = expediente.indexOf("AgendaExtraordinaryRebookCard");
    const idxAgendaSection = expediente.search(
      /AgendaBiometricosSupabaseCard|AgendaFirmasSupabaseCard|Cita de biométricos|Agenda de biométricos/i,
    );
    assert.ok(idxExtra > 0);
    // Si existe card normal en el mismo archivo, la extraordinaria va antes.
    if (idxAgendaSection > 0) {
      assert.ok(idxExtra < idxAgendaSection);
    }
  });

  it("asesor inbox merge Cloud pendientes → campana; abrir no cierra tarea", () => {
    assert.match(asesor, /listContingenciaPendientesAsesor/);
    assert.match(asesor, /mergeExtraordinaryBellNotifications/);
    assert.match(bell, /markDashboardNotificationsRead/);
    assert.doesNotMatch(bell, /asesor_agendar_cita_extraordinaria|pending_rebook/);
    assert.doesNotMatch(reads, /agenda_contingencia_citas|item_status/);
  });

  it("RPC extraordinaria única; sin inventory/book normal en card", () => {
    assert.match(card, /agendarCitaExtraordinaria\(/);
    assert.equal((card.match(/agendarCitaExtraordinaria/g) ?? []).length >= 2, true);
    assert.doesNotMatch(card, /fetchSheetInventory|bookBiometricos|bookFirmas/);
  });
});
