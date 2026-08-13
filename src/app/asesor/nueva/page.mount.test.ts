import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("P181 montaje /asesor/nueva reprecal propio", () => {
  const nueva = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/page.tsx"),
    "utf8",
  );
  const copy = readFileSync(
    join(
      process.cwd(),
      "src/domain/expedientes/asesor-nueva-reprecal.ts",
    ),
    "utf8",
  );

  it("A) own same: confirmación, no create, link expediente", () => {
    assert.match(nueva, /decideNuevaAfterGate/);
    assert.match(nueva, /confirm_same/);
    assert.match(copy, /Este NSS ya está en tus expedientes/);
    assert.match(nueva, /Sí, enviar de nuevo/);
    assert.match(nueva, /Abrir expediente/);
    assert.match(nueva, /createExpediente/);
  });

  it("B/J) confirm llama iniciar + redirect detalle", () => {
    assert.match(nueva, /executeNuevaReprecalConfirm/);
    assert.match(nueva, /iniciarReprecalificacion/);
    assert.match(nueva, /nuevaExpedienteDetallePath/);
    assert.match(nueva, /router\.push\(nuevaExpedienteDetallePath/);
    assert.match(copy, /Precalificación enviada nuevamente al Editor/);
    assert.match(nueva, /MSG_NUEVA_REPRECAL_SUCCESS/);
  });

  it("C) doble click: guard + disabled submitting", () => {
    assert.match(nueva, /createNuevaReprecalSubmitGuard/);
    assert.match(nueva, /guardRef/);
    assert.match(nueva, /disabled=\{submitting/);
  });

  it("D) pending copy permite confirmar", () => {
    assert.match(nueva, /reprecalificacion_pendiente_id/);
    assert.match(nueva, /MSG_NUEVA_REPRECAL_PENDING/);
    assert.match(copy, /Ya existe una precalificación en revisión/);
  });

  it("E) change program confirm + validate change_programa", () => {
    assert.match(nueva, /confirm_change/);
    assert.match(nueva, /Sí, solicitar cambio y enviar/);
    assert.match(nueva, /change_programa/);
  });

  it("F) P179 ok_create sigue createExpediente", () => {
    assert.match(nueva, /decision\.action !== "create"/);
    assert.match(nueva, /createExpediente\(input\)/);
  });

  it("G/H) blocked other/ambiguous: error, 0 reprecal", () => {
    assert.match(nueva, /action === "blocked"/);
  });

  it("no deshabilita Enviar solo por gate reprecal (usa confirmación)", () => {
    assert.doesNotMatch(
      nueva,
      /disabled=\{submitting \|\| showExistingActiveUi\}/,
    );
    assert.doesNotMatch(nueva, /messageForNuevaExistingActiveExpediente/);
  });
});
