import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { formatMesaAgendaSedeLabel } from "@/lib/mesaAgendaCitasUi";

describe("notificacion sede P119.1", () => {
  it("label: nuevas sedes vs históricos", () => {
    assert.equal(formatMesaAgendaSedeLabel("monterrey"), "Monterrey");
    assert.equal(formatMesaAgendaSedeLabel("apodaca"), "Apodaca");
    assert.equal(formatMesaAgendaSedeLabel("notificacion"), "Sin sede");
    assert.equal(formatMesaAgendaSedeLabel(null), "Sin sede");
  });

  it("UI y RPC pasan locationId real", () => {
    const tab = readFileSync(
      path.join(process.cwd(), "src/components/asesor/AgendaNotificacionSupabaseTab.tsx"),
      "utf8",
    );
    assert.match(tab, /locationId:\s*sedeId/);
    assert.match(tab, /CYNTHIA_SEDE_MONTERREY_ID/);

    const mig = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/107_notificacion_sede_location.sql",
      ),
      "utf8",
    );
    assert.match(mig, /p_location_id TEXT/);
    assert.doesNotMatch(mig, /v_location_id TEXT := 'notificacion'/);
  });
});
