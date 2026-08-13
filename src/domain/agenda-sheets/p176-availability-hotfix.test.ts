import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applySheetInventoryToSlots,
  type InventoryAvailabilityResponse,
} from "./apply-inventory-availability";
import type { AgendaBiometricosSlotAvailability } from "@/domain/agenda-biometricos/types";

describe("P176 Apodaca 17 AGO biometricos availability", () => {
  it("fresh inventory → horarios 08:00/10:00 visibles (no temporalmente no disponible)", () => {
    const inventory: InventoryAvailabilityResponse = {
      ok: true,
      fresh: true,
      enforced: true,
      slots: [
        {
          slot_time: "08:00:00",
          available: 2,
          physical_total: 2,
        },
        {
          slot_time: "10:00:00",
          available: 2,
          physical_total: 2,
        },
      ],
    };
    const fromConfig: AgendaBiometricosSlotAvailability[] = [];
    const { slots, blockedReason } = applySheetInventoryToSlots(
      fromConfig,
      inventory,
      "2026-08-17",
    );
    assert.equal(blockedReason, null);
    assert.equal(slots.find((s) => s.time === "08:00")?.remaining, 2);
    assert.equal(slots.find((s) => s.time === "10:00")?.remaining, 2);
  });

  it("fresh=false → Agenda temporalmente no disponible (fail-closed)", () => {
    const inventory: InventoryAvailabilityResponse = {
      ok: true,
      fresh: false,
      enforced: true,
      slots: [],
    };
    const { blockedReason } = applySheetInventoryToSlots(
      [],
      inventory,
      "2026-08-17",
    );
    assert.equal(blockedReason, "Agenda temporalmente no disponible");
  });
});

describe("P176 live-sync auth contracts", () => {
  const src = readFileSync(
    join(
      process.cwd(),
      "supabase/functions/agenda-sheet-live-sync/index.ts",
    ),
    "utf8",
  );

  it("usa profiles.active (no is_active) y roles reales", () => {
    assert.match(src, /select\("app_role,active"\)/);
    assert.doesNotMatch(src, /is_active/);
    assert.match(src, /mesa_admin/);
    assert.match(src, /mesa_interno/);
    assert.match(src, /mesa_externo/);
    assert.doesNotMatch(src, /"mesa_control"/);
    assert.doesNotMatch(src, /"admin"/);
    assert.match(src, /profileErr/);
    assert.match(src, /kind\?: "biometricos" \| "firmas" \| "inscripcion"/);
  });
});

describe("P176 migration 174 contract", () => {
  it("restaura fresh/enforced/slots y acepta inscripcion", () => {
    const mig = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/174_fix_agenda_inventory_availability_contract.sql",
      ),
      "utf8",
    );
    assert.match(mig, /'fresh'/);
    assert.match(mig, /'enforced'/);
    assert.match(mig, /'slots'/);
    assert.match(mig, /'inscripcion'/);
    assert.match(mig, /sheet_slot_time/);
    assert.match(mig, /physical_total/);
  });
});
