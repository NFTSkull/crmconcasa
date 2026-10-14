import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

describe("Disponibilidad permanente de inscripción para asesores", () => {
  it("siempre ofrece consulta en la pantalla de asesor sin adelantar etapas", () => {
    const page = readFileSync(join(process.cwd(),"src/app/asesor/page.tsx"),"utf8");
    const button = readFileSync(join(process.cwd(),"src/components/asesor/AsesorInscripcionCuposButton.tsx"),"utf8");
    assert.match(page,/AsesorInscripcionCuposButton/);
    assert.match(button,/Ver cupos de inscripción/);
    assert.match(button,/agenda_sheet_inventory_availability/);
    assert.match(button,/invokeAgendaSheetLiveSync/);
    assert.match(button,/locationId:"monterrey"/);
    assert.match(button,/Solo consulta/);
    assert.doesNotMatch(button,/book_inscripcion_extraordinaria/);
  });
});
