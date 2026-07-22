import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MESA_CANCELACION_OPERATIVA_CARD_BADGE,
  MESA_CANCELACION_OPERATIVA_CARD_CTA,
  MESA_CANCELACION_OPERATIVA_CARD_TITLE,
} from "./mesa-cancelacion-operativa";
import {
  MESA_RECHAZO_OPERATIVO_CARD_BADGE,
  MESA_RECHAZO_OPERATIVO_CARD_CTA,
  MESA_RECHAZO_OPERATIVO_CARD_TITLE,
} from "./mesa-rechazo-operativo-ux";

describe("Mesa rechazo/cancelación UX copy y semántica visual", () => {
  it("copy distingue continuar vs no continuará", () => {
    assert.match(MESA_RECHAZO_OPERATIVO_CARD_TITLE, /puede continuar/i);
    assert.match(MESA_RECHAZO_OPERATIVO_CARD_BADGE, /puede continuar/i);
    assert.match(MESA_RECHAZO_OPERATIVO_CARD_CTA, /rechazo operativo/i);
    assert.match(MESA_CANCELACION_OPERATIVA_CARD_TITLE, /no continuará/i);
    assert.match(MESA_CANCELACION_OPERATIVA_CARD_BADGE, /no continuará/i);
    assert.match(MESA_CANCELACION_OPERATIVA_CARD_CTA, /no continuará/i);
  });

  it("tarjeta rechazo usa estilo oscuro; cancelación usa verde", () => {
    const rechazo = readFileSync(
      join(
        process.cwd(),
        "src/components/mesa-control/MesaRechazoOperativoPostBiometricosCard.tsx",
      ),
      "utf8",
    );
    const cancel = readFileSync(
      join(
        process.cwd(),
        "src/components/mesa-control/MesaCancelarExpedienteCard.tsx",
      ),
      "utf8",
    );
    assert.match(rechazo, /bg-neutral-950/);
    assert.match(rechazo, /border-neutral-800/);
    assert.match(rechazo, /data-testid="mesa-rechazo-operativo"/);
    assert.doesNotMatch(
      rechazo,
      /className="scroll-mt-4 rounded-xl border-2 border-red-400 bg-red-50/,
    );
    assert.doesNotMatch(
      rechazo,
      /<label[^>]*>[\s\S]*Condición biométrica|Booking biométrico de referencia|Razón biométrica/,
    );
    assert.doesNotMatch(rechazo, /data-testid="mesa-rechazo-condicion"/);
    assert.match(rechazo, /data-testid="mesa-rechazo-motivo"/);
    assert.match(rechazo, /data-testid="mesa-rechazo-nota"/);
    assert.match(cancel, /border-emerald-500/);
    assert.match(cancel, /bg-emerald-50/);
    assert.doesNotMatch(
      cancel,
      /className="scroll-mt-4 rounded-xl border-2 border-slate-500 bg-slate-50/,
    );
  });
});
