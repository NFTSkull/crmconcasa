import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("P164 UI montaje reprecal detalle / editor / nueva", () => {
  const actions = readFileSync(
    join(
      process.cwd(),
      "src/components/asesor/AsesorReprecalificacionActions.tsx",
    ),
    "utf8",
  );
  const detalle = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );
  const editor = readFileSync(
    join(process.cwd(), "src/app/editor/[id]/page.tsx"),
    "utf8",
  );
  const nueva = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/page.tsx"),
    "utf8",
  );

  it("detalle monta CTAs Enviar nueva precalificación y Cambiar programa", () => {
    assert.match(detalle, /AsesorReprecalificacionActions/);
    assert.match(actions, /Enviar nueva precalificación/);
    assert.match(actions, /Cambiar programa/);
    assert.match(actions, /Modificar programa solicitado/);
  });

  it("detalle: acciones embebidas al final de Decisión del editor (sin card exterior)", () => {
    assert.equal(
      (detalle.match(/<AsesorReprecalificacionActions\b/g) ?? []).length,
      1,
    );
    assert.match(detalle, /Decisión del editor[\s\S]*AsesorReprecalificacionActions/);
    assert.match(detalle, /<AsesorReprecalificacionActions[\s\S]*embedded/);
    const afterDecision = detalle.split("Decisión del editor")[1] ?? "";
    assert.match(
      afterDecision,
      /AsesorReprecalificacionActions[\s\S]*<\/div>\s*\{!hasMontoAprobado/,
    );
    assert.match(actions, /embedded\?: boolean/);
    assert.match(
      actions,
      /embedded\s*\?\s*"mt-4 border-t border-gray-200 pt-4/,
    );
    assert.match(actions, /!embedded \? \(/);
  });

  it("nueva precal y cambio convergen en lookupNssPrecalGate + iniciarReprecalificacion", () => {
    assert.match(actions, /lookupNssPrecalGate/);
    assert.match(actions, /iniciarReprecalificacion/);
    assert.doesNotMatch(actions, /createExpediente/);
    assert.doesNotMatch(actions, /cambiarPrograma\b/);
    assert.doesNotMatch(actions, /iniciarCambioPrograma/);
  });

  it("misma idempotency key vía ref + newReprecalIdempotencyKey; disabled en vuelo", () => {
    assert.match(actions, /idempotencyKeyRef/);
    assert.match(actions, /newReprecalIdempotencyKey/);
    assert.match(actions, /inFlightRef/);
    assert.match(actions, /disabled=\{submitting/);
  });

  it("cambio: no permite mismo programa (disabled sin cambioEsCambio)", () => {
    assert.match(actions, /cambioEsCambio/);
    assert.match(actions, /disabled=\{submitting \|\| !cambioEsCambio\}/);
    assert.match(actions, /Enviar nueva precalificación/);
  });

  it("pendiente: vigente vs solicitado separados; monto vigente no sustituido", () => {
    assert.match(actions, /Precalificación en revisión/);
    assert.match(actions, /Programa vigente/);
    assert.match(actions, /Programa solicitado/);
    assert.match(actions, /Monto vigente/);
    assert.match(actions, /montoAprobadoVigente/);
  });

  it("confirma copy diferido de programa/monto", () => {
    assert.match(
      actions,
      /El monto aprobado actual[\s\S]*conservará hasta que el Editor/,
    );
    assert.match(
      actions,
      /permanecerán vigentes hasta que[\s\S]*el Editor apruebe/,
    );
    assert.match(actions, /Si el Editor determina que no cumple/);
  });

  it("editor: banner actualización + mismo upsertEditorDecision", () => {
    assert.match(editor, /Actualización de precalificación/);
    assert.match(editor, /Programa vigente/);
    assert.match(editor, /Programa solicitado/);
    assert.match(editor, /upsertEditorDecision/);
    assert.equal(
      (editor.match(/upsertEditorDecision/g) ?? []).length,
      1,
    );
  });

  it("nueva: expediente activo existente no crea ni inicia reprecal (P169)", () => {
    assert.match(nueva, /reprecal_own_mesa|isNssPrecalGateReprecalAllowed/);
    assert.match(nueva, /messageForNuevaExistingActiveExpediente/);
    assert.match(nueva, /Abrir expediente/);
    assert.doesNotMatch(nueva, /iniciarReprecalificacion/);
    assert.doesNotMatch(nueva, /newReprecalIdempotencyKey/);
    assert.doesNotMatch(nueva, /Volver a precalificar/);
    assert.match(nueva, /createExpediente/);
  });

  it("detalle PRE-MESA: canShow no exige submittedToMesa (P169)", () => {
    assert.match(actions, /canShowAsesorReprecalActions/);
    const flow = readFileSync(
      join(process.cwd(), "src/domain/expedientes/asesor-reprecal-flow.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      flow,
      /if\s*\(\s*!input\.submittedToMesa\s*\)\s*return\s+false/,
    );
    assert.match(detalle, /Guardar monto/);
    assert.match(detalle, /AsesorReprecalificacionActions/);
  });

  it("opciones de producto sin Subcuenta en el CTA de cambio", () => {
    assert.match(actions, /CAMBIAR_PROGRAMA_OPTIONS|opcionesCambioPrograma/);
    assert.doesNotMatch(actions, /value:\s*"Subcuenta"/);
  });
});
