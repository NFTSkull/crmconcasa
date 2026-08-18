/**
 * P189 mapping v2 FINAL — fixture sintético + PDFs reales (AcroForm antes de flatten).
 * NO PII real. NO Cloud.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { PROPUESTA_BAND_90_130 } from "./build-propuesta-mejoramiento.ts";
import { SOLICITUD_MUST_STAY_BLANK } from "./fill-solicitud.ts";
import { generateInfonavitPdfAudited } from "./generate-infonavit-pdf.ts";
import {
  buildCertSnapshot,
  CERT_FIXTURES,
} from "./p189-cert-fixtures.ts";
import {
  buildP189V2FixtureSnapshot,
  P189_V2_FIXTURE,
} from "./p189-mapping-v2.fixture.ts";
import { parseDireccionMxParaSolicitud } from "./parse-direccion-mx.ts";
import { parseNombrePersonaMx } from "./parse-nombre-persona-mx.ts";
import {
  BAJO_FIELD,
  PRESUPUESTO_FIELD,
  SOLICITUD_FIELD,
} from "./template-contract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "infonavit-templates", "v1");
const OUT_DIR = "/tmp/p189-hotfix-visual";

function loadTemplate(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(TEMPLATES, name)));
}

describe("P189 mapping v2 FINAL fixture", () => {
  it("monto Mejoravit 102529.36; aprobado 113921.51 NO se usa", () => {
    const snap = buildP189V2FixtureSnapshot();
    assert.equal(snap.credito?.montoSolicitado, 102529.36);
    assert.equal(snap.mejora?.presupuestoEstimado, 102529.36);
    assert.notEqual(snap.credito?.montoSolicitado, P189_V2_FIXTURE.montoAprobado);
    assert.notEqual(snap.mejora?.presupuestoEstimado, 113921.51);
  });

  it("nombre titular parseado", () => {
    const t = parseNombrePersonaMx(P189_V2_FIXTURE.nombreCliente);
    assert.equal(t.nombres, "RUBEN");
    assert.equal(t.apellidoPaterno, "CASTRO");
    assert.equal(t.apellidoMaterno, "QUIÑONES");
  });

  it("dirección fixture", () => {
    const d = parseDireccionMxParaSolicitud(P189_V2_FIXTURE.direccionOpcional);
    assert.equal(d.codigoPostal, "67250");
    assert.equal(d.municipio, "JUAREZ");
    assert.equal(d.entidad, "NUEVO LEÓN");
    assert.equal(d.colonia, "CENTRO");
    assert.equal(d.numeroExterior, "309");
    assert.equal(d.calle, "CALLE PRUEBA");
  });

  it("referencias parseadas; teléfono fijo vacío", () => {
    const snap = buildP189V2FixtureSnapshot();
    const r1 = snap.referencias![0]!;
    const r2 = snap.referencias![1]!;
    assert.equal(r1.nombres, "DEBANHI ABIGAIL");
    assert.equal(r1.apellidoPaterno, "CASTRO");
    assert.equal(r1.apellidoMaterno, "JUAREZ");
    assert.equal(r1.celular, "8118900001");
    assert.equal(r1.telefono, "");
    assert.equal(r1.lada, "");
    assert.equal(r2.nombres, "NALLELY BERENICE");
    assert.equal(r2.apellidoPaterno, "CASTRO");
    assert.equal(r2.apellidoMaterno, "JUAREZ");
    assert.equal(r2.celular, "8118900002");
    assert.equal(r2.telefono, "");
  });

  it("beneficiario parseado", () => {
    const snap = buildP189V2FixtureSnapshot();
    assert.equal(snap.beneficiario?.nombres, "MAYRA ELIZABETH");
    assert.equal(snap.beneficiario?.apellidoPaterno, "JUAREZ");
    assert.equal(snap.beneficiario?.apellidoMaterno, "CASTAÑEDA");
    assert.equal(snap.beneficiario?.parentesco, "CONCUBINA");
  });

  it("ciudad NUEVO LEÓN + propuesta 4 líneas idéntica", () => {
    const snap = buildP189V2FixtureSnapshot();
    assert.equal(snap.localidad, "NUEVO LEÓN");
    assert.equal(snap.ciudadCierre, "NUEVO LEÓN");
    assert.equal(snap.mejora?.descripcion, PROPUESTA_BAND_90_130.join("\n"));
  });

  it("genera 3 PDFs reales y certifica AcroForm", async () => {
    const snapshot = buildP189V2FixtureSnapshot();
    mkdirSync(OUT_DIR, { recursive: true });

    const carta = await generateInfonavitPdfAudited({
      documentType: "carta_bajo_protesta",
      templateBytes: loadTemplate("carta-bajo-protesta.pdf"),
      snapshot,
    });
    const pres = await generateInfonavitPdfAudited({
      documentType: "presupuesto_mejoramiento",
      templateBytes: loadTemplate("presupuesto-mejoramiento.pdf"),
      snapshot,
    });
    const sol = await generateInfonavitPdfAudited({
      documentType: "solicitud_inscripcion_credito",
      templateBytes: loadTemplate("solicitud-inscripcion-credito.pdf"),
      snapshot,
    });

    writeFileSync(join(OUT_DIR, "carta-bajo-protesta.pdf"), carta.bytes);
    writeFileSync(join(OUT_DIR, "presupuesto-mejoramiento.pdf"), pres.bytes);
    writeFileSync(join(OUT_DIR, "solicitud-inscripcion-credito.pdf"), sol.bytes);

    const cartaDoc = await PDFDocument.load(carta.bytes);
    const presDoc = await PDFDocument.load(pres.bytes);
    const solDoc = await PDFDocument.load(sol.bytes);
    assert.equal(cartaDoc.getForm().getFields().length, 0);
    assert.equal(presDoc.getForm().getFields().length, 0);
    assert.equal(solDoc.getForm().getFields().length, 0);

    // CARTA
    assert.equal(carta.fieldsBeforeFlatten[BAJO_FIELD.T0_LOCALIDAD], "NUEVO LEÓN");
    assert.ok(String(carta.fieldsBeforeFlatten[BAJO_FIELD.T1_DIA]).length > 0);
    assert.ok(String(carta.fieldsBeforeFlatten[BAJO_FIELD.T2_MES]).length > 0);
    assert.ok(String(carta.fieldsBeforeFlatten[BAJO_FIELD.T3_ANIO]).length > 0);
    assert.equal(
      carta.fieldsBeforeFlatten[BAJO_FIELD.T4_DESC0],
      PROPUESTA_BAND_90_130[0],
    );
    assert.equal(
      carta.fieldsBeforeFlatten[BAJO_FIELD.T5_DESC1],
      PROPUESTA_BAND_90_130[1],
    );
    assert.equal(
      carta.fieldsBeforeFlatten[BAJO_FIELD.T6_DESC2],
      PROPUESTA_BAND_90_130[2],
    );
    assert.equal(
      carta.fieldsBeforeFlatten[BAJO_FIELD.T7_DESC3],
      PROPUESTA_BAND_90_130[3],
    );
    assert.equal(
      carta.fieldsBeforeFlatten[BAJO_FIELD.T8_NOMBRE],
      "RUBEN CASTRO QUIÑONES",
    );
    assert.equal(carta.fieldsBeforeFlatten[BAJO_FIELD.T9_NSS], "18900000001");

    // PRESUPUESTO
    assert.match(
      String(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T0_NOMBRE]),
      /RUBEN/,
    );
    assert.equal(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T1_NSS], "18900000001");
    assert.match(
      String(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T2_DIR0]),
      /CALLE PRUEBA|67250/,
    );
    assert.equal(
      pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T5_DESC0],
      PROPUESTA_BAND_90_130[0],
    );
    assert.equal(
      pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T6_DESC1],
      PROPUESTA_BAND_90_130[1],
    );
    assert.equal(
      pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T7_DESC2],
      PROPUESTA_BAND_90_130[2],
    );
    assert.equal(
      pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T8_DESC3],
      PROPUESTA_BAND_90_130[3],
    );
    assert.equal(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T9_MONTO], "102,529.36");
    assert.ok(String(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T10_FECHA]).length > 0);
    assert.notEqual(
      pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T9_MONTO],
      "113,921.51",
    );

    // SOLICITUD
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T0_NSS], "18900000001");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T1_CURP], "XAXX010101HDFXXX09");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T2_RFC], "XAXX010101000");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T3_AP_PATERNO], "CASTRO");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T4_AP_MATERNO], "QUIÑONES");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T5_NOMBRES], "RUBEN");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T11_CELULAR], "5518900001");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T9_LADA], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T10_TELEFONO], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T18_CALLE], "CALLE PRUEBA");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T19_NO_EXT], "309");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T23_COLONIA], "CENTRO");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T24_ENTIDAD], "NUEVO LEÓN");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T25_MUNICIPIO], "JUAREZ");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T26_CP], "67250");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T27_MONTO], "102,529.36");
    assert.notEqual(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T27_MONTO], "113,921.51");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T29_PLAZO], "10");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T30_REF1_AP_PAT], "CASTRO");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T34_REF1_AP_MAT], "JUAREZ");
    assert.equal(
      sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T35_REF1_NOMBRES],
      "DEBANHI ABIGAIL",
    );
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T36_REF1_LADA], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T37_REF1_TEL], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T38_REF1_CEL], "8118900001");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T39_REF2_AP_PAT], "CASTRO");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T40_REF2_AP_MAT], "JUAREZ");
    assert.equal(
      sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T41_REF2_NOMBRES],
      "NALLELY BERENICE",
    );
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T42_REF2_LADA], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T43_REF2_TEL], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T44_REF2_CEL], "8118900002");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T45_BEN_PARENTESCO], "CONCUBINA");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T46_BEN_AP_PAT], "JUAREZ");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T47_BEN_AP_MAT], "CASTAÑEDA");
    assert.equal(
      sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T48_BEN_NOMBRES],
      "MAYRA ELIZABETH",
    );
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T56_CIUDAD], "NUEVO LEÓN");
    assert.ok(String(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T57_DIA]).length > 0);
    assert.ok(String(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T58_MES]).length > 0);
    assert.ok(String(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T59_ANIO]).length > 0);
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T55_CREDITO_INFONAVIT_BLANK], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T49_PROMOTOR_BLANK], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.C0_GENERO_F], false);
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.C1_GENERO_M], false);
  });
});

const CERT_OUT = "/tmp/p189-cert-visual";
const DOCS = [
  ["carta", "carta_bajo_protesta", "carta-bajo-protesta.pdf"],
  ["presupuesto", "presupuesto_mejoramiento", "presupuesto-mejoramiento.pdf"],
  ["solicitud", "solicitud_inscripcion_credito", "solicitud-inscripcion-credito.pdf"],
] as const;

function pdfText(path: string): string {
  if (!existsSync("/opt/homebrew/bin/pdftotext") && !existsSync("/usr/bin/pdftotext")) {
    return "";
  }
  try {
    return execFileSync("pdftotext", ["-layout", path, "-"], {
      encoding: "utf8",
    });
  } catch {
    return "";
  }
}

describe("P189 certificación visual 5 fixtures × 3 PDFs", () => {
  it("genera 15 PDFs, AcroForm + pdftotext, guard 113921.51", async () => {
    mkdirSync(CERT_OUT, { recursive: true });
    let generated = 0;
    for (const def of CERT_FIXTURES) {
      const snapshot = buildCertSnapshot(def);
      assert.notEqual(snapshot.credito?.montoSolicitado, def.montoAprobado);
      const dir = join(CERT_OUT, def.id);
      mkdirSync(dir, { recursive: true });
      for (const [short, docType, file] of DOCS) {
        const result = await generateInfonavitPdfAudited({
          documentType: docType,
          templateBytes: loadTemplate(file),
          snapshot,
        });
        const outPath = join(dir, `${short}.pdf`);
        writeFileSync(outPath, result.bytes);
        generated += 1;
        const doc = await PDFDocument.load(result.bytes);
        assert.equal(doc.getForm().getFields().length, 0);

        const f = result.fieldsBeforeFlatten;
        if (short === "carta") {
          assert.equal(f[BAJO_FIELD.T0_LOCALIDAD], "NUEVO LEÓN");
          assert.ok(String(f[BAJO_FIELD.T8_NOMBRE]).length > 0);
          assert.ok(String(f[BAJO_FIELD.T9_NSS]).length > 0);
          assert.ok(String(f[BAJO_FIELD.T4_DESC0]).length > 0);
        }
        if (short === "presupuesto") {
          assert.match(String(f[PRESUPUESTO_FIELD.T9_MONTO]), /,/);
          assert.notEqual(String(f[PRESUPUESTO_FIELD.T9_MONTO]), "113,921.51");
          assert.ok(String(f[PRESUPUESTO_FIELD.T5_DESC0]).length > 0);
          assert.ok(String(f[PRESUPUESTO_FIELD.T2_DIR0]).length > 0);
        }
        if (short === "solicitud") {
          assert.equal(f[SOLICITUD_FIELD.T56_CIUDAD], "NUEVO LEÓN");
          assert.notEqual(String(f[SOLICITUD_FIELD.T27_MONTO]), "113,921.51");
          assert.equal(f[SOLICITUD_FIELD.T9_LADA], "");
          assert.equal(f[SOLICITUD_FIELD.T10_TELEFONO], "");
          assert.equal(f[SOLICITUD_FIELD.T36_REF1_LADA], "");
          assert.equal(f[SOLICITUD_FIELD.T37_REF1_TEL], "");
          for (const blank of SOLICITUD_MUST_STAY_BLANK) {
            assert.equal(f[blank], "");
          }
        }

        const text = pdfText(outPath);
        if (text) {
          assert.doesNotMatch(text, /113,?921\.51/);
          if (short === "carta" || short === "solicitud") {
            assert.match(text, /NUEVO/);
          }
          if (short === "presupuesto") {
            assert.ok(text.includes(def.nss));
            assert.doesNotMatch(text, /113,921/);
          }
        }
      }
      const cartaDesc = String(
        (await generateInfonavitPdfAudited({
          documentType: "carta_bajo_protesta",
          templateBytes: loadTemplate("carta-bajo-protesta.pdf"),
          snapshot,
        })).fieldsBeforeFlatten[BAJO_FIELD.T4_DESC0],
      );
      const presDesc = String(
        (await generateInfonavitPdfAudited({
          documentType: "presupuesto_mejoramiento",
          templateBytes: loadTemplate("presupuesto-mejoramiento.pdf"),
          snapshot,
        })).fieldsBeforeFlatten[PRESUPUESTO_FIELD.T5_DESC0],
      );
      assert.equal(cartaDesc, presDesc);
    }
    assert.equal(generated, 15);
  });
});
