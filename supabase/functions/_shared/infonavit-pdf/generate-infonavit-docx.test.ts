/**
 * P189 DOCX — consistencia PDF audit vs texto nativo Word.
 * LOCAL. No Cloud. No modifica flatten.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateInfonavitDocx } from "./generate-infonavit-docx.ts";
import { generateInfonavitPdfAudited } from "./generate-infonavit-pdf.ts";
import {
  assertNativeEditableText,
  inspectInfonavitDocx,
  replaceDocxText,
} from "./infonavit-docx-inspect.ts";
import {
  buildCertSnapshot,
  CERT_FIXTURES,
} from "./p189-cert-fixtures.ts";
import { buildInfonavitPrintModel } from "./print-model.ts";
import {
  BAJO_FIELD,
  PRESUPUESTO_FIELD,
  SOLICITUD_FIELD,
} from "./template-contract.ts";
import type { InfonavitDocumentType } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "infonavit-templates", "v1");
const OUT_DIR = "/tmp/p189-docx-cert";

function loadTemplate(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(TEMPLATES, name)));
}

function nonEmptyPdfValues(fields: Record<string, string | boolean>): string[] {
  return Object.values(fields)
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

function fold(s: string): string {
  return s.normalize("NFC");
}

function assertContains(haystack: string, needle: string, label: string) {
  if (!needle.trim()) return;
  const h = fold(haystack);
  const n = fold(needle);
  assert.ok(
    h.includes(n),
    `${label}: DOCX no contiene «${n.slice(0, 80)}» (haystackLen=${h.length} hasNUEVO=${h.includes("NUEVO")})`,
  );
}

describe("P189 DOCX nativo — 5 fixtures", () => {
  it("emite 15 DOCX y coincide con PDF/print-model", async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const types: Array<{
      id: InfonavitDocumentType;
      file: string;
      out: string;
    }> = [
      {
        id: "carta_bajo_protesta",
        file: "carta-bajo-protesta.pdf",
        out: "carta.docx",
      },
      {
        id: "presupuesto_mejoramiento",
        file: "presupuesto-mejoramiento.pdf",
        out: "presupuesto.docx",
      },
      {
        id: "solicitud_inscripcion_credito",
        file: "solicitud-inscripcion-credito.pdf",
        out: "solicitud.docx",
      },
    ];

    let emitted = 0;
    for (const def of CERT_FIXTURES) {
      const snapshot = buildCertSnapshot(def);
      const model = buildInfonavitPrintModel(snapshot);
      const dir = join(OUT_DIR, def.id);
      mkdirSync(dir, { recursive: true });

      for (const t of types) {
        const pdf = await generateInfonavitPdfAudited({
          documentType: t.id,
          templateBytes: loadTemplate(t.file),
          snapshot,
        });
        const docx = await generateInfonavitDocx({
          documentType: t.id,
          snapshot,
        });
        assert.ok(docx.byteLength > 2000, `${def.id}/${t.out} demasiado pequeño`);
        writeFileSync(join(dir, t.out), docx);
        emitted += 1;

        const inspect = await inspectInfonavitDocx(docx);
        assert.equal(inspect.hasWordprocessingMl, true, "content type word");
        assert.equal(inspect.drawingCount, 0, `${def.id}/${t.out} w:drawing`);
        assert.equal(inspect.blipCount, 0, `${def.id}/${t.out} a:blip`);
        assert.equal(inspect.mediaFiles.length, 0, `${def.id}/${t.out} media`);
        assert.ok(inspect.wtTexts.length > 10, "tiene runs de texto");

        if (t.id === "carta_bajo_protesta" || t.id === "presupuesto_mejoramiento") {
          assertContains(
            inspect.joinedText,
            model.nombreCompleto,
            `${def.id}/${t.out} nombre`,
          );
        } else {
          assertContains(inspect.joinedText, model.nombres, `${def.id} nombres`);
          assertContains(
            inspect.joinedText,
            model.apellidoPaterno,
            `${def.id} paterno`,
          );
          if (model.apellidoMaterno) {
            assertContains(
              inspect.joinedText,
              model.apellidoMaterno,
              `${def.id} materno`,
            );
          }
        }
        assertContains(inspect.joinedText, model.nss, `${def.id} nss`);
        if (t.id === "carta_bajo_protesta" || t.id === "presupuesto_mejoramiento") {
          for (const line of model.propuestaLines) {
            assertContains(inspect.joinedText, line, `${def.id}/${t.out} propuesta`);
          }
        }

        if (t.id === "carta_bajo_protesta") {
          assertContains(inspect.joinedText, model.localidad, `${def.id} localidad`);
        }
        if (t.id === "presupuesto_mejoramiento" || t.id === "solicitud_inscripcion_credito") {
          assertContains(inspect.joinedText, model.montoMejoravit, `${def.id} monto`);
        }
        if (t.id === "presupuesto_mejoramiento") {
          assertContains(inspect.joinedText, model.domicilioLibre, `${def.id} domicilio`);
          assertContains(inspect.joinedText, model.presupuestoFecha, `${def.id} fecha pres`);
        }
        if (t.id === "solicitud_inscripcion_credito") {
          assertContains(inspect.joinedText, model.ciudadCierre, `${def.id} ciudad`);
          if (model.curp) assertContains(inspect.joinedText, model.curp, "curp");
          if (model.rfc) assertContains(inspect.joinedText, model.rfc, "rfc");
          if (model.plazo) assertContains(inspect.joinedText, model.plazo, "plazo");
          assertContains(inspect.joinedText, model.ref1.nombres, "ref1");
          assertContains(inspect.joinedText, model.ref2.nombres, "ref2");
          assertContains(inspect.joinedText, model.beneficiario.nombres, "beneficiario");
          assert.ok(
            inspect.joinedText.includes("Tipo de identificación"),
            "label ID editable presente",
          );
        }

        for (const val of nonEmptyPdfValues(pdf.fieldsBeforeFlatten)) {
          assertContains(
            inspect.joinedText,
            val,
            `${def.id}/${t.out} PDF field`,
          );
        }

        if (t.id === "carta_bajo_protesta") {
          assert.equal(
            pdf.fieldsBeforeFlatten[BAJO_FIELD.T8_NOMBRE],
            model.nombreCompleto,
          );
          assert.equal(pdf.fieldsBeforeFlatten[BAJO_FIELD.T9_NSS], model.nss);
        }
        if (t.id === "presupuesto_mejoramiento") {
          assert.equal(
            pdf.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T9_MONTO],
            model.montoMejoravit,
          );
        }
        if (t.id === "solicitud_inscripcion_credito") {
          assert.equal(
            pdf.fieldsBeforeFlatten[SOLICITUD_FIELD.T27_MONTO],
            model.montoMejoravit,
          );
          assert.equal(
            pdf.fieldsBeforeFlatten[SOLICITUD_FIELD.T29_PLAZO],
            model.plazo,
          );
        }
      }
    }
    assert.equal(emitted, 15);
  });
});

describe("P189 DOCX editabilidad nativa — fixture principal", () => {
  it("nombre/domicilio/monto/propuesta/refs/beneficiario están en w:t, no en drawing", async () => {
    const snapshot = buildCertSnapshot(CERT_FIXTURES[0]!);
    const model = buildInfonavitPrintModel(snapshot);

    const carta = await generateInfonavitDocx({
      documentType: "carta_bajo_protesta",
      snapshot,
    });
    const pres = await generateInfonavitDocx({
      documentType: "presupuesto_mejoramiento",
      snapshot,
    });
    const sol = await generateInfonavitDocx({
      documentType: "solicitud_inscripcion_credito",
      snapshot,
    });

    const iCarta = await inspectInfonavitDocx(carta);
    const iPres = await inspectInfonavitDocx(pres);
    const iSol = await inspectInfonavitDocx(sol);

    assert.equal(assertNativeEditableText(iCarta, model.nombreCompleto), true);
    assert.equal(assertNativeEditableText(iCarta, model.nss), true);
    assert.equal(
      assertNativeEditableText(iCarta, model.propuestaLines[0] ?? ""),
      true,
    );

    assert.equal(assertNativeEditableText(iPres, model.nombreCompleto), true);
    assert.equal(assertNativeEditableText(iPres, model.domicilioLibre), true);
    assert.equal(assertNativeEditableText(iPres, model.montoMejoravit), true);
    assert.equal(
      assertNativeEditableText(iPres, model.propuestaLines[0] ?? ""),
      true,
    );

    assert.equal(assertNativeEditableText(iSol, model.ref1.nombres), true);
    assert.equal(assertNativeEditableText(iSol, model.ref2.nombres), true);
    assert.equal(
      assertNativeEditableText(iSol, model.beneficiario.nombres),
      true,
    );
    assert.equal(assertNativeEditableText(iSol, model.montoMejoravit), true);
    assert.equal(iCarta.drawingCount + iPres.drawingCount + iSol.drawingCount, 0);
    assert.equal(iCarta.mediaFiles.length + iPres.mediaFiles.length + iSol.mediaFiles.length, 0);

    const edited = await replaceDocxText(pres, model.montoMejoravit, "1.00");
    const iEdited = await inspectInfonavitDocx(edited);
    assert.equal(assertNativeEditableText(iEdited, "1.00"), true);
    assert.equal(iEdited.joinedText.includes(model.montoMejoravit), false);
  });
});
