import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20261001183000_agenda_mty_shared_pool_cap_15.sql"),
  "utf8",
);
const webhookGuard = readFileSync(
  join(root, "supabase/functions/agenda-sheet-webhook-cap-guard/index.ts"),
  "utf8",
);
const liveSync = readFileSync(
  join(root, "supabase/functions/agenda-sheet-live-sync/index.ts"),
  "utf8",
);
const notificationErrors = readFileSync(
  join(root, "src/domain/agenda-biometricos/book-notificacion-rpc-error.ts"),
  "utf8",
);

describe("Monterrey shared capacity Firmas + Inscripción + Notificación", () => {
  it("DB hard-cap is exactly 15 and covers the three booking kinds", () => {
    assert.match(migration, /15 - public\.agenda_mty_shared_pool_occupancy/);
    assert.match(migration, /'firmas'::public\.booking_kind/);
    assert.match(migration, /'inscripcion'::public\.booking_kind/);
    assert.match(migration, /'notificacion'::public\.booking_kind/);
    assert.match(migration, /SIN_CUPO_COMBINADO_MTY_15/);
    assert.match(migration, /a0_agenda_guard_mty_shared_pool_biu/);
  });

  it("Drive snapshot is the fresh physical authority and October audit is seeded", () => {
    assert.match(migration, /agenda_mty_shared_pool_snapshot/);
    assert.match(migration, /observed_at >= NOW\(\) - interval '6 hours'/);
    assert.match(migration, /DATE '2026-10-02',15/);
    assert.match(migration, /DATE '2026-10-05',16/);
    assert.match(migration, /drive_october_2026_audit/);
  });

  it("manual Drive row #16 is rejected across the shared sections", () => {
    assert.match(webhookGuard, /MONTERREY FIRMAS/);
    assert.match(webhookGuard, /MONTERREY INSCRIPCION/);
    assert.match(webhookGuard, /NOTIFICACIONES CRM/);
    assert.match(webhookGuard, /sharedPool\.physicalTotal > 15/);
    assert.match(webhookGuard, /shared_daily_capacity_full/);
    assert.match(webhookGuard, /La fila nueva fue retirada/);
  });

  it("live availability refreshes the physical snapshot and blocks a full shared day", () => {
    assert.match(liveSync, /countMonterreySharedPhysical/);
    assert.match(liveSync, /agenda_mty_shared_pool_snapshot_upsert/);
    assert.match(liveSync, /agenda_mty_shared_pool_remaining/);
    assert.match(liveSync, /sharedDailyRemaining < 1/);
    assert.match(liveSync, /completaron los 15 lugares/);
  });

  it("Notificación shows a clear shared-cap message", () => {
    assert.match(notificationErrors, /sin_cupo_combinado_mty_15/);
    assert.match(notificationErrors, /15 lugares de Monterrey/);
  });
});
