import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Mesa Citas — P110 sin clasificación manual en UI", () => {
  const files = [
    "src/components/mesa-control/MesaAgendaCitasClient.tsx",
    "src/components/mesa-control/MesaAgendaCitasList.tsx",
    "src/components/mesa-control/MesaAgendaCitasDayView.tsx",
    "src/components/mesa-control/MesaAgendaCitasWeekView.tsx",
    "src/components/mesa-control/MesaAgendaCitasEntryParts.tsx",
  ] as const;

  it("no muestra Clasificación Excel / Clasificación para Excel en lista/día/semana", () => {
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /Clasificación Excel/);
      assert.doesNotMatch(source, /Clasificación para Excel/);
      assert.doesNotMatch(source, /MesaAgendaReportGroupControl/);
    }
  });

  it("Client no llama RPC de clasificación", () => {
    const source = read("src/components/mesa-control/MesaAgendaCitasClient.tsx");
    assert.doesNotMatch(source, /setMesaAgendaBookingReportGroup/);
    assert.doesNotMatch(source, /mesa_set_agenda_booking_report_group/);
    assert.doesNotMatch(source, /onReportGroupChange/);
    assert.doesNotMatch(source, /handleReportGroupChange/);
  });

  it("componente de select manual ya no existe", () => {
    let missing = false;
    try {
      read("src/components/mesa-control/MesaAgendaReportGroupControl.tsx");
    } catch {
      missing = true;
    }
    assert.equal(missing, true);
  });
});
