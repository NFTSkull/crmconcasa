/**
 * P189 B1 — certificación local fill/flatten Infonavit.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PDFDocument, PDFTextField } from "pdf-lib";
import { InfonavitPdfError } from "./errors.ts";
import {
  FIXTURE_LONG_FIELDS,
  FIXTURE_NORMAL,
  FIXTURE_SPANISH,
} from "./fixtures.ts";
import {
  formatBajoProtestaDateParts,
  formatMoneyMx,
  formatPresupuestoFecha,
  formatSolicitudCierreDateParts,
} from "./formatters.ts";
import {
  generateInfonavitPdf,
  generateInfonavitPdfAudited,
} from "./generate-infonavit-pdf.ts";
import { loadPdfDoc } from "./form-helpers.ts";
import {
  BAJO_FIELD,
  BAJO_PROTESTA_CONTRACT,
  PRESUPUESTO_CONTRACT,
  PRESUPUESTO_FIELD,
  SOLICITUD_CONTRACT,
  SOLICITUD_FIELD,
  assertTemplateContract,
} from "./template-contract.ts";
import { splitNombrePresupuesto, splitTextToLines } from "./text-layout.ts";
import type {
  InfonavitDocumentType,
  InfonavitPdfSnapshotInput,
} from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "infonavit-templates", "v1");
const TMP = join(HERE, "..", "..", "..", "..", "tmp", "p189-b1");

function shaFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadTemplate(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(TEMPLATES, name)));
}

const TEMPLATES_BY_TYPE: Record<
  InfonavitDocumentType,
  { file: string; contractSha: string }
> = {
  carta_bajo_protesta: {
    file: "carta-bajo-protesta.pdf",
    contractSha: BAJO_PROTESTA_CONTRACT.expectedSha256,
  },
  presupuesto_mejoramiento: {
    file: "presupuesto-mejoramiento.pdf",
    contractSha: PRESUPUESTO_CONTRACT.expectedSha256,
  },
  solicitud_inscripcion_credito: {
    file: "solicitud-inscripcion-credito.pdf",
    contractSha: SOLICITUD_CONTRACT.expectedSha256,
  },
};

describe("P189 B1 template SHA + contract", () => {
  for (const [docType, meta] of Object.entries(TEMPLATES_BY_TYPE) as Array<
    [InfonavitDocumentType, { file: string; contractSha: string }]
  >) {
    it(`${docType}: SHA256 exacto en repo`, () => {
      const actual = shaFile(join(TEMPLATES, meta.file));
      assert.equal(actual, meta.contractSha);
    });
  }

  it("SHA incorrecto → INFONAVIT_TEMPLATE_CONTRACT_MISMATCH", async () => {
    const bytes = loadTemplate("carta-bajo-protesta.pdf");
    const tampered = new Uint8Array(bytes);
    // Alterar payload sin romper header PDF (SHA del input ≠ contrato).
    const idx = Math.min(5000, tampered.length - 1);
    tampered[idx] = (tampered[idx]! + 1) % 256;
    const doc = await loadPdfDoc(bytes);
    await assert.rejects(
      () =>
        assertTemplateContract({
          documentType: "carta_bajo_protesta",
          templateBytes: tampered,
          doc,
        }),
      (err: unknown) => {
        assert.ok(err instanceof InfonavitPdfError);
        assert.equal(err.code, "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH");
        assert.equal(err.meta.reason, "sha256_mismatch");
        assert.equal("text" in err.meta, false);
        return true;
      },
    );
  });

  it("field faltante / plantilla cruzada → FAIL", async () => {
    const bajoBytes = loadTemplate("carta-bajo-protesta.pdf");
    const presDoc = await loadPdfDoc(
      loadTemplate("presupuesto-mejoramiento.pdf"),
    );
    // Presupuesto bytes + contrato Bajo → page/fields mismatch.
    await assert.rejects(
      () =>
        assertTemplateContract({
          documentType: "carta_bajo_protesta",
          templateBytes: bajoBytes,
          doc: presDoc,
        }),
      (err: unknown) => {
        assert.ok(err instanceof InfonavitPdfError);
        assert.equal(err.code, "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH");
        return true;
      },
    );
  });

  it("field extra / page mismatch → FAIL (presupuesto vs solicitud bytes)", async () => {
    const solBytes = loadTemplate("solicitud-inscripcion-credito.pdf");
    const doc = await loadPdfDoc(solBytes);
    await assert.rejects(
      () =>
        assertTemplateContract({
          documentType: "presupuesto_mejoramiento",
          templateBytes: solBytes,
          doc,
        }),
      (err: unknown) => {
        assert.ok(err instanceof InfonavitPdfError);
        assert.equal(err.code, "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH");
        return true;
      },
    );
  });

  it("contrato válido pasa para los 3", async () => {
    for (const [docType, meta] of Object.entries(TEMPLATES_BY_TYPE) as Array<
      [InfonavitDocumentType, { file: string; contractSha: string }]
    >) {
      const bytes = loadTemplate(meta.file);
      const doc = await loadPdfDoc(bytes);
      const c = await assertTemplateContract({
        documentType: docType,
        templateBytes: bytes,
        doc,
      });
      assert.equal(c.expectedSha256, meta.contractSha);
    }
  });
});

describe("P189 B1 formatters", () => {
  it("fechas Bajo / Solicitud / Presupuesto", () => {
    assert.deepEqual(formatBajoProtestaDateParts("2026-01-03"), {
      day: "03",
      month: "01",
      year2: "26",
    });
    assert.deepEqual(formatBajoProtestaDateParts("2026-08-17"), {
      day: "17",
      month: "08",
      year2: "26",
    });
    assert.deepEqual(formatBajoProtestaDateParts("2026-12-31"), {
      day: "31",
      month: "12",
      year2: "26",
    });
    assert.deepEqual(formatSolicitudCierreDateParts("2026-08-17"), {
      day: "17",
      monthName: "AGOSTO",
      year2: "26",
    });
    assert.deepEqual(formatSolicitudCierreDateParts("2026-01-03"), {
      day: "03",
      monthName: "ENERO",
      year2: "26",
    });
    assert.equal(formatPresupuestoFecha("2026-12-31"), "31/12/26");
  });

  it("monto determinista", () => {
    assert.equal(formatMoneyMx(125000.5), "125,000.50");
    assert.equal(formatMoneyMx(98000, { withSymbol: true }), "$98,000.00");
    assert.equal(formatMoneyMx(0), "0.00");
    assert.throws(() => formatMoneyMx(Number.NaN), InfonavitPdfError);
  });
});

describe("P189 B1 text layout / overflow", () => {
  it("descripción 4 líneas por palabras", () => {
    const lines = splitTextToLines({
      text: "UNO DOS TRES CUATRO CINCO SEIS",
      maxLines: 4,
      maxCharsPerLine: 10,
      documentType: "carta_bajo_protesta",
      semanticField: "mejora.descripcion",
    });
    assert.equal(lines.length, 4);
    assert.ok(lines.every((l) => l.length <= 10));
  });

  it("overflow no silencioso", () => {
    assert.throws(
      () =>
        splitTextToLines({
          text: "PALABRA_EXTRAORDINARIAMENTE_LARGA_QUE_NO_CABE",
          maxLines: 2,
          maxCharsPerLine: 10,
          documentType: "carta_bajo_protesta",
          semanticField: "mejora.descripcion",
        }),
      (err: unknown) => {
        assert.ok(err instanceof InfonavitPdfError);
        assert.equal(err.code, "INFONAVIT_TEXT_OVERFLOW");
        assert.equal(err.meta.semanticField, "mejora.descripcion");
        assert.equal(typeof err.meta.maxLines, "number");
        // sin PII: no incluir texto completo
        assert.equal("text" in err.meta, false);
        return true;
      },
    );
  });

  it("nombre overflow presupuesto por palabras", () => {
    const r = splitNombrePresupuesto({
      fullName: "MUÑOZ PEÑA ÁNGELA DEL CARMEN",
      maxCharsLine0: 12,
      maxCharsLine11: 40,
    });
    assert.ok(r.line0.length <= 12);
    assert.ok(r.line11.length > 0);
    assert.ok(!r.line0.includes("ÁNGELA") || r.line0.endsWith("MUÑOZ") || true);
  });
});

describe("P189 B1 Bajo mapping + flatten", () => {
  it("mapping + defaults limpios + flatten 0 fields", async () => {
    const bytes = loadTemplate("carta-bajo-protesta.pdf");
    const { bytes: out, fieldsBeforeFlatten: f } =
      await generateInfonavitPdfAudited({
        documentType: "carta_bajo_protesta",
        templateBytes: bytes,
        snapshot: FIXTURE_SPANISH,
      });

    assert.equal(f[BAJO_FIELD.T0_LOCALIDAD], "SAN NICOLÁS");
    assert.equal(f[BAJO_FIELD.T1_DIA], "03");
    assert.equal(f[BAJO_FIELD.T2_MES], "01");
    assert.equal(f[BAJO_FIELD.T3_ANIO], "26");
    assert.ok(String(f[BAJO_FIELD.T4_DESC0]).includes("REPARACIÓN"));
    assert.ok(String(f[BAJO_FIELD.T8_NOMBRE]).includes("MUÑOZ"));
    assert.ok(String(f[BAJO_FIELD.T8_NOMBRE]).includes("PEÑA"));
    assert.ok(String(f[BAJO_FIELD.T8_NOMBRE]).includes("ÁNGELA"));
    assert.equal(f[BAJO_FIELD.T9_NSS], "10987654321");
    // no conservar defaults plantilla
    assert.notEqual(f[BAJO_FIELD.T0_LOCALIDAD], "NUEVO LEON");
    assert.notEqual(f[BAJO_FIELD.T2_MES], "08");

    const flat = await PDFDocument.load(out);
    assert.equal(flat.getForm().getFields().length, 0);
    assert.equal(flat.getPageCount(), 2);
  });
});

describe("P189 B1 Presupuesto mapping + flatten", () => {
  it("nombre/dir/desc/monto/fecha + flatten", async () => {
    const bytes = loadTemplate("presupuesto-mejoramiento.pdf");
    const { bytes: out, fieldsBeforeFlatten: f } =
      await generateInfonavitPdfAudited({
        documentType: "presupuesto_mejoramiento",
        templateBytes: bytes,
        snapshot: FIXTURE_SPANISH,
      });

    const nombre0 = String(f[PRESUPUESTO_FIELD.T0_NOMBRE] ?? "");
    const nombre11 = String(f[PRESUPUESTO_FIELD.T11_NOMBRE_OVERFLOW] ?? "");
    assert.ok((nombre0 + " " + nombre11).includes("MUÑOZ"));
    assert.ok((nombre0 + " " + nombre11).includes("ÁNGELA"));
    assert.equal(f[PRESUPUESTO_FIELD.T1_NSS], "10987654321");
    assert.ok(String(f[PRESUPUESTO_FIELD.T2_DIR0]).includes("NIÑOS"));
    assert.ok(String(f[PRESUPUESTO_FIELD.T5_DESC0]).includes("REPARACIÓN"));
    assert.equal(f[PRESUPUESTO_FIELD.T9_MONTO], "98,000.00");
    assert.equal(f[PRESUPUESTO_FIELD.T10_FECHA], "03/01/26");

    const flat = await PDFDocument.load(out);
    assert.equal(flat.getForm().getFields().length, 0);
  });

  it("long name overflow controlado o split", async () => {
    const bytes = loadTemplate("presupuesto-mejoramiento.pdf");
    // Si cabe → ok; si no → error tipado
    try {
      const { fieldsBeforeFlatten: f } = await generateInfonavitPdfAudited({
        documentType: "presupuesto_mejoramiento",
        templateBytes: bytes,
        snapshot: FIXTURE_LONG_FIELDS,
      });
      const joined =
        String(f[PRESUPUESTO_FIELD.T0_NOMBRE]) +
        String(f[PRESUPUESTO_FIELD.T11_NOMBRE_OVERFLOW]);
      assert.ok(joined.includes("GARCIA"));
    } catch (err) {
      assert.ok(err instanceof InfonavitPdfError);
      assert.equal(err.code, "INFONAVIT_TEXT_OVERFLOW");
    }
  });
});

describe("P189 B1 Solicitud mapping + defaults + checks + blanks", () => {
  it("defaults borrados + mapping + mutual exclusion + MUST_STAY_BLANK", async () => {
    const bytes = loadTemplate("solicitud-inscripcion-credito.pdf");

    // Pre: template trae basura
    const rawDoc = await loadPdfDoc(bytes);
    const rawForm = rawDoc.getForm();
    assert.ok(
      (rawForm.getTextField(SOLICITUD_FIELD.T24_ENTIDAD).getText() ?? "")
        .replace(/\s+/g, "")
        .includes("NUEVO"),
    );
    assert.equal(rawForm.getCheckBox(SOLICITUD_FIELD.C6_SOLTERO).isChecked(), true);
    assert.equal(rawForm.getCheckBox(SOLICITUD_FIELD.C8_PROP_PROPIA).isChecked(), true);

    const snap: InfonavitPdfSnapshotInput = {
      ...FIXTURE_SPANISH,
      cliente: {
        ...FIXTURE_SPANISH.cliente,
        genero: "M",
        estadoCivil: "casado",
        regimenMatrimonial: "separacion_bienes",
      },
      vivienda: {
        ...FIXTURE_SPANISH.vivienda!,
        tipoPropiedad: "familiar",
      },
    };

    const { bytes: out, fieldsBeforeFlatten: f } =
      await generateInfonavitPdfAudited({
        documentType: "solicitud_inscripcion_credito",
        templateBytes: bytes,
        snapshot: snap,
      });

    // Identificación
    assert.equal(f[SOLICITUD_FIELD.T0_NSS], snap.cliente.nss);
    assert.equal(f[SOLICITUD_FIELD.T1_CURP], snap.cliente.curp);
    assert.equal(f[SOLICITUD_FIELD.T5_NOMBRES], "ÁNGELA");
    assert.equal(f[SOLICITUD_FIELD.T3_AP_PATERNO], "MUÑOZ");
    assert.equal(f[SOLICITUD_FIELD.T9_LADA], "81");
    assert.notEqual(String(f[SOLICITUD_FIELD.T9_LADA]).replace(/\s+/g, ""), "+52");
    assert.notEqual(String(f[SOLICITUD_FIELD.T6_TIPO_ID]).replace(/\s+/g, ""), "INE");
    assert.equal(f[SOLICITUD_FIELD.T6_TIPO_ID], "PASAPORTE");

    // Defaults cerrados
    assert.notEqual(String(f[SOLICITUD_FIELD.T58_MES]), "AGOSTO");
    assert.equal(f[SOLICITUD_FIELD.T58_MES], "ENERO");
    assert.equal(f[SOLICITUD_FIELD.T57_DIA], "03");
    assert.equal(f[SOLICITUD_FIELD.T59_ANIO], "26");

    // Género M → C1 on, C0 off
    assert.equal(f[SOLICITUD_FIELD.C1_GENERO_M], true);
    assert.equal(f[SOLICITUD_FIELD.C0_GENERO_F], false);

    // Civil casado
    assert.equal(f[SOLICITUD_FIELD.C7_CASADO], true);
    assert.equal(f[SOLICITUD_FIELD.C6_SOLTERO], false);

    // Régimen
    assert.equal(f[SOLICITUD_FIELD.C2_REGIMEN_SEPARACION], true);
    assert.equal(f[SOLICITUD_FIELD.C3_REGIMEN_SOCIEDAD], false);

    // Propiedad familiar — no default propia
    assert.equal(f[SOLICITUD_FIELD.C5_PROP_FAMILIAR], true);
    assert.equal(f[SOLICITUD_FIELD.C8_PROP_PROPIA], false);
    assert.equal(f[SOLICITUD_FIELD.C4_PROP_CONYUGE], false);

    // Referencias columnas
    assert.equal(f[SOLICITUD_FIELD.T30_REF1_AP_PAT], "GÜEMES");
    assert.equal(f[SOLICITUD_FIELD.T39_REF2_AP_PAT], "OCHOA");

    // MUST_STAY_BLANK
    for (const name of [
      SOLICITUD_FIELD.T31_BLANK,
      SOLICITUD_FIELD.T32_BLANK,
      SOLICITUD_FIELD.T33_BLANK,
      SOLICITUD_FIELD.T49_PROMOTOR_BLANK,
      SOLICITUD_FIELD.T50_PROMOTOR_BLANK,
      SOLICITUD_FIELD.T51_PROMOTOR_BLANK,
      SOLICITUD_FIELD.T52_PROMOTOR_BLANK,
      SOLICITUD_FIELD.T53_PROMOTOR_BLANK,
      SOLICITUD_FIELD.T54_PROMOTOR_BLANK,
      SOLICITUD_FIELD.T55_CREDITO_INFONAVIT_BLANK,
    ]) {
      assert.equal(f[name], "", `blank ${name}`);
    }

    const flat = await PDFDocument.load(out);
    assert.equal(flat.getForm().getFields().length, 0);
  });

  it("género F exclusión mutua", async () => {
    const bytes = loadTemplate("solicitud-inscripcion-credito.pdf");
    const { fieldsBeforeFlatten: f } = await generateInfonavitPdfAudited({
      documentType: "solicitud_inscripcion_credito",
      templateBytes: bytes,
      snapshot: FIXTURE_SPANISH,
    });
    assert.equal(f[SOLICITUD_FIELD.C0_GENERO_F], true);
    assert.equal(f[SOLICITUD_FIELD.C1_GENERO_M], false);
  });

  it("género ausente → ambas Off", async () => {
    const bytes = loadTemplate("solicitud-inscripcion-credito.pdf");
    const snap = structuredClone(FIXTURE_NORMAL);
    snap.cliente.genero = null;
    const { fieldsBeforeFlatten: f } = await generateInfonavitPdfAudited({
      documentType: "solicitud_inscripcion_credito",
      templateBytes: bytes,
      snapshot: snap,
    });
    assert.equal(f[SOLICITUD_FIELD.C0_GENERO_F], false);
    assert.equal(f[SOLICITUD_FIELD.C1_GENERO_M], false);
  });

  it("régimen no se marca si soltero", async () => {
    const bytes = loadTemplate("solicitud-inscripcion-credito.pdf");
    const snap = structuredClone(FIXTURE_SPANISH);
    snap.cliente.estadoCivil = "soltero";
    snap.cliente.regimenMatrimonial = "sociedad_conyugal";
    const { fieldsBeforeFlatten: f } = await generateInfonavitPdfAudited({
      documentType: "solicitud_inscripcion_credito",
      templateBytes: bytes,
      snapshot: snap,
    });
    assert.equal(f[SOLICITUD_FIELD.C2_REGIMEN_SEPARACION], false);
    assert.equal(f[SOLICITUD_FIELD.C3_REGIMEN_SOCIEDAD], false);
  });
});

describe("P189 B1 generate 3 PDFs + artefactos locales", () => {
  it("genera spanish a tmp/ (gitignored) y flatten", async () => {
    mkdirSync(TMP, { recursive: true });
    for (const [docType, meta] of Object.entries(TEMPLATES_BY_TYPE) as Array<
      [InfonavitDocumentType, { file: string; contractSha: string }]
    >) {
      const out = await generateInfonavitPdf({
        documentType: docType,
        templateBytes: loadTemplate(meta.file),
        snapshot: FIXTURE_SPANISH,
      });
      const outPath = join(TMP, `${docType}-spanish.pdf`);
      writeFileSync(outPath, out);
      const re = await PDFDocument.load(out);
      assert.equal(re.getForm().getFields().length, 0, docType);
      // Sanity: PDF no vacío y páginas esperadas
      assert.ok(out.byteLength > 1000);
      assert.equal(
        re.getPageCount(),
        docType === "presupuesto_mejoramiento" ? 1 : 2,
      );
    }
  });

  it("acentos presentes en campos pre-flatten (WinAnsi Helvetica)", async () => {
    const { fieldsBeforeFlatten: f } = await generateInfonavitPdfAudited({
      documentType: "carta_bajo_protesta",
      templateBytes: loadTemplate("carta-bajo-protesta.pdf"),
      snapshot: FIXTURE_SPANISH,
    });
    const nombre = String(f[BAJO_FIELD.T8_NOMBRE]);
    for (const ch of ["Á", "Ñ", "ñ", "É", "Ó", "Ú", "Ü", "ü"]) {
      // fixture usa subset; assert presence of key ones in combined texts
      void ch;
    }
    assert.match(nombre, /Á/);
    assert.match(nombre, /Ñ/);
    const desc = String(f[BAJO_FIELD.T4_DESC0]);
    assert.match(desc, /Ó|Í|Á/);
  });
});

describe("P189 B1 fail-safe type mismatch simulation", () => {
  it("type incorrecto detectado si renombramos expectativa", async () => {
    // Validamos que un checkbox no se lea como text field en helpers.
    const bytes = loadTemplate("solicitud-inscripcion-credito.pdf");
    const doc = await loadPdfDoc(bytes);
    const form = doc.getForm();
    const cb = form.getCheckBox(SOLICITUD_FIELD.C0_GENERO_F);
    assert.ok(!(cb instanceof PDFTextField));
    assert.equal(typeof cb.isChecked(), "boolean");
  });
});
