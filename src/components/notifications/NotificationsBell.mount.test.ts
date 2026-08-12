import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Campana notificaciones — mark-read al abrir (estático).
 */
describe("NotificationsBell mark-read montaje", () => {
  const bell = readFileSync(
    join(process.cwd(), "src/components/notifications/NotificationsBell.tsx"),
    "utf8",
  );
  const asesor = readFileSync(join(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
  const reads = readFileSync(
    join(process.cwd(), "src/lib/dashboardNotificationReads.ts"),
    "utf8",
  );

  it("campana usa unreadCount y marca leídas al abrir", () => {
    assert.match(bell, /countUnreadDashboardNotifications/);
    assert.match(bell, /markDashboardNotificationsRead/);
    assert.match(bell, /persistMarkRead\(notifications\)/);
    assert.match(bell, /Sin notificaciones nuevas/);
    assert.match(bell, /notifications-bell-badge/);
  });

  it("falla de persistencia restaura estado previo", () => {
    assert.match(bell, /setReads\(previous\)/);
    assert.match(bell, /No se pudieron marcar como leídas/);
  });

  it("asesor pasa userKey a la campana", () => {
    assert.match(asesor, /<NotificationsBell[\s\S]*userKey=\{currentUser\.email\}/);
  });

  it("store de leídas no toca P167 / correcciones", () => {
    assert.doesNotMatch(reads, /asesor-pendientes|correccion_requerida.*filter|hasAsesorCorreccion/);
    assert.match(reads, /no cierra tareas P167|No cierra tareas P167/i);
  });

  it("extraordinary_rebook_required tiene estilo y no se confunde con P167", () => {
    const ui = readFileSync(
      join(process.cwd(), "src/components/notifications/notifications-ui.tsx"),
      "utf8",
    );
    assert.match(ui, /extraordinary_rebook_required/);
    assert.match(reads, /No cierra tareas P167/i);
  });

  it("P172: asesores cargan pendientes Cloud; mark-read no toca contingencia", () => {
    assert.match(asesor, /listContingenciaPendientesAsesor/);
    assert.match(asesor, /mergeExtraordinaryBellNotifications/);
    assert.doesNotMatch(reads, /agenda_contingencia|pending_rebook/);
  });
});
