import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectInscripcionRebookRequirement } from "./detect-rebook";

describe("detectInscripcionRebookRequirement", () => {
  it("true: REAGENDA + INSCRIP (variantes)", () => {
    assert.equal(
      detectInscripcionRebookRequirement("REAGENDA INSCRIPCION"),
      true,
    );
    assert.equal(
      detectInscripcionRebookRequirement("REAGENDA INSCRIPCIÓN"),
      true,
    );
    assert.equal(
      detectInscripcionRebookRequirement("REAGENDA INSCRIPCION, FALLA SISTEMA"),
      true,
    );
    assert.equal(
      detectInscripcionRebookRequirement("  reagenda   inscripción  "),
      true,
    );
  });

  it("false: otros REAGENDA / sin REAGENDA / vacío", () => {
    assert.equal(
      detectInscripcionRebookRequirement("REAGENDA BIOMETRICOS"),
      false,
    );
    assert.equal(detectInscripcionRebookRequirement("REAGENDA FIRMA"), false);
    assert.equal(detectInscripcionRebookRequirement("REAGENDA"), false);
    assert.equal(detectInscripcionRebookRequirement("INSCRIPCION"), false);
    assert.equal(detectInscripcionRebookRequirement(""), false);
    assert.equal(detectInscripcionRebookRequirement(null), false);
    assert.equal(detectInscripcionRebookRequirement("X"), false);
    assert.equal(detectInscripcionRebookRequirement("BETTY"), false);
  });
});
