import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MESA_GESTIONAR_CANCELAR_CONTINUAR_CONFIRM } from "@/lib/mesaAgendaCitasUi";

describe("MesaGestionarCitaDialog cancel_continue (P118b)", () => {
  it("diálogo usa confirmación reforzada y RPC dedicada", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/mesa-control/MesaGestionarCitaDialog.tsx"),
      "utf8",
    );
    assert.match(src, /mesaCancelarCitaYContinuar/);
    assert.match(src, /MESA_GESTIONAR_CANCELAR_CONTINUAR_CONFIRM/);
    assert.match(src, /canMesaCancelarCitaYContinuar/);
    assert.match(src, /showCancelContinue/);
    assert.equal(src.includes("disabled\n                title={MESA_GESTIONAR_CANCELAR_CONTINUAR_STOP}"), false);
    assert.match(MESA_GESTIONAR_CANCELAR_CONTINUAR_CONFIRM, /quedará registrada/i);
  });
});
