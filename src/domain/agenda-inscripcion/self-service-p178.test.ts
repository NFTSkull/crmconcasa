/**
 * P178 — self-service inscripción (eligibility UI helpers + source_type).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatInscripcionCupoLabel,
  isInscripcionSelfServiceVisible,
  type AgendaInscripcionRequirementSourceType,
} from "@/domain/agenda-inscripcion";

const root = process.cwd();

describe("P178 self-service inscripción domain", () => {
  it("source_type incluye asesor", () => {
    const types = readFileSync(
      join(root, "src/domain/agenda-inscripcion/types.ts"),
      "utf8",
    );
    assert.match(
      types,
      /AgendaInscripcionRequirementSourceType = "sheet" \| "mesa" \| "asesor"/,
    );
    const sample: AgendaInscripcionRequirementSourceType = "asesor";
    assert.equal(sample, "asesor");
  });

  it("self-service visible solo elegible sin requirement", () => {
    assert.equal(
      isInscripcionSelfServiceVisible({
        hasOpenRequirement: false,
        eligible: true,
      }),
      true,
    );
    assert.equal(
      isInscripcionSelfServiceVisible({
        hasOpenRequirement: true,
        eligible: true,
      }),
      false,
    );
    assert.equal(
      isInscripcionSelfServiceVisible({
        hasOpenRequirement: false,
        eligible: false,
      }),
      false,
    );
  });

  it("cupo 3 lugares", () => {
    assert.match(formatInscripcionCupoLabel(3, 3), /3 lugares/);
  });

  it("mig 175: source asesor + eligibility + auto-require en book", () => {
    const mig = readFileSync(
      join(root, "supabase/migrations/175_asesor_inscripcion_self_service.sql"),
      "utf8",
    );
    assert.match(mig, /'sheet', 'mesa', 'asesor'/);
    assert.match(mig, /agenda_inscripcion_asesor_eligibility/);
    assert.match(mig, /agenda_inscripcion_tiene_biometricos_previos/);
    assert.match(mig, /auto_created_during_book/);
    assert.match(mig, /solo Monterrey/);
    assert.match(mig, /TIME '11:00'/);
    assert.match(mig, /requirement_created/);
    assert.doesNotMatch(mig, /OPERATIONAL_APPLY/);
  });
});
