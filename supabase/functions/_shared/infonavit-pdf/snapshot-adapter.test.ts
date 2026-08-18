/**
 * P189 B4 — adapter B3→B1 + mapping + generate over fixtures ficticias.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  mapDbDocumentTypeToB1,
  INFONAVIT_DB_TO_B1,
} from "./document-type-map.ts";
import { InfonavitPdfError } from "./errors.ts";
import {
  adaptB3SnapshotToB1,
  InfonavitSnapshotAdapterError,
} from "./snapshot-adapter.ts";
import { generateInfonavitPdfAudited } from "./generate-infonavit-pdf.ts";
import { validateGeneratedInfonavitPdf } from "./pdf-output-validation.ts";
import {
  BAJO_FIELD,
  PRESUPUESTO_FIELD,
  SOLICITUD_FIELD,
} from "./template-contract.ts";
import { workerSecretIsValid } from "./worker-auth.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "infonavit-templates", "v1");

function loadTemplate(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(TEMPLATES, name)));
}

function b3Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    fechaDocumento: "2026-08-17",
    localidad: "Monterrey",
    cliente: {
      nombres: "Ana",
      apellidoPaterno: "Lopez",
      apellidoMaterno: "Perez",
      nss: "18400000001",
      curp: "GAVF850101HDFRRL09",
      rfc: "XAXX010101000",
      celular: "5511111111",
      correo: "p189.fixture@test.local",
      telefono: "",
      ladaTelefono: "",
      genero: "F",
      estadoCivil: "soltero",
      regimenMatrimonial: "",
      identificacion: {
        tipo: "INE",
        numero: "123456789",
        vigencia: "2030-12-31",
      },
    },
    empresa: {
      nombre: "Empresa Fixture P189",
      registroPatronal: "Y1234567890",
      telefono: "8187654321",
      lada: "",
      extension: "",
    },
    vivienda: {
      calle: "Av Siempre Viva",
      noExt: "123",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "Centro",
      entidad: "Nuevo Leon",
      municipio: "Monterrey",
      cp: "64000",
      tipoPropiedad: "propia",
    },
    credito: {
      montoSolicitado: 150000,
      plazoAnios: 5,
    },
    referencias: [
      {
        nombres: "Luis",
        apellidoPaterno: "Garcia",
        apellidoMaterno: "Ruiz",
        lada: "81",
        telefono: "12345678",
        celular: "5522222222",
      },
      {
        nombres: "Maria",
        apellidoPaterno: "Sanchez",
        apellidoMaterno: "Ortiz",
        lada: "55",
        telefono: "44444444",
        celular: "5533333333",
      },
    ],
    beneficiario: {
      nombres: "Pedro",
      apellidoPaterno: "Lopez",
      apellidoMaterno: "Perez",
      parentesco: "Hijo",
    },
    mejora: {
      descripcion: "Impermeabilizacion de losa y cambio de ventanas",
      presupuestoEstimado: 25000,
    },
    ...overrides,
  };
}

describe("P189 B4 document type mapping", () => {
  it("mapea los 3 tipos DB → B1 de forma explícita", () => {
    assert.equal(
      mapDbDocumentTypeToB1("infonavit_carta_bajo_protesta"),
      "carta_bajo_protesta",
    );
    assert.equal(
      mapDbDocumentTypeToB1("infonavit_presupuesto_mejoramiento"),
      "presupuesto_mejoramiento",
    );
    assert.equal(
      mapDbDocumentTypeToB1("infonavit_solicitud_inscripcion"),
      "solicitud_inscripcion_credito",
    );
    assert.deepEqual(INFONAVIT_DB_TO_B1, {
      infonavit_carta_bajo_protesta: "carta_bajo_protesta",
      infonavit_presupuesto_mejoramiento: "presupuesto_mejoramiento",
      infonavit_solicitud_inscripcion: "solicitud_inscripcion_credito",
    });
  });

  it("rechaza tipo desconocido", () => {
    assert.throws(
      () => mapDbDocumentTypeToB1("infonavit_carta"),
      (err: unknown) => err instanceof InfonavitPdfError,
    );
  });
});

describe("P189 B4 snapshot adapter", () => {
  it("adapta payload B3 a input B1 con plazoAnios y blanks", () => {
    const snap = adaptB3SnapshotToB1(b3Payload());
    assert.equal(snap.fechaDocumento, "2026-08-17");
    assert.equal(snap.cliente.nombres, "Ana");
    assert.equal(snap.cliente.nss, "18400000001");
    assert.equal(snap.cliente.telefono, "");
    assert.equal(snap.cliente.ladaTelefono, "");
    assert.equal(snap.empresa?.lada, "");
    assert.equal(snap.empresa?.extension, "");
    assert.equal(snap.credito?.plazoAnios, 5);
    assert.equal(snap.credito?.plazoMeses, undefined);
    assert.equal(snap.referencias?.length, 2);
    assert.equal(snap.mejora?.presupuestoEstimado, 25000);
    assert.equal(snap.credito?.montoSolicitado, 150000);
  });

  it("no infiere LADA desde teléfono 10 dígitos", () => {
    const snap = adaptB3SnapshotToB1(b3Payload());
    assert.equal(snap.cliente.ladaTelefono, "");
    assert.equal(snap.empresa?.lada, "");
    assert.notEqual(snap.cliente.celular, snap.cliente.ladaTelefono);
  });

  it("exige exactamente 2 referencias", () => {
    const one = b3Payload();
    one.referencias = [(one.referencias as unknown[])[0]];
    assert.throws(
      () => adaptB3SnapshotToB1(one),
      (err: unknown) =>
        err instanceof InfonavitSnapshotAdapterError &&
        err.reason === "referencias_count",
    );
  });

  it("rechaza plazoMeses en payload B3", () => {
    const p = b3Payload();
    (p.credito as Record<string, unknown>).plazoMeses = 60;
    assert.throws(
      () => adaptB3SnapshotToB1(p),
      (err: unknown) =>
        err instanceof InfonavitSnapshotAdapterError &&
        err.reason === "plazoMeses_forbidden",
    );
  });

  it("partial snapshot B8: campos vacíos no fallan", () => {
    const partial = b3Payload({
      localidad: "",
      cliente: {
        nombres: "",
        apellidoPaterno: "",
        apellidoMaterno: "",
        nss: "18400000001",
        curp: "",
        rfc: "",
        celular: "5511111111",
        correo: "",
        telefono: "",
        ladaTelefono: "",
        genero: "",
        estadoCivil: "",
        regimenMatrimonial: "",
        identificacion: { tipo: "", numero: "", vigencia: "" },
      },
      vivienda: {
        calle: "",
        noExt: "",
        noInt: "",
        lote: "",
        manzana: "",
        colonia: "",
        entidad: "",
        municipio: "",
        cp: "",
        tipoPropiedad: "",
      },
      credito: { montoSolicitado: 150000, plazoAnios: null },
      referencias: [
        { nombres: "Ref Uno", apellidoPaterno: "", apellidoMaterno: "", lada: "", telefono: "", celular: "8111111111" },
        { nombres: "", apellidoPaterno: "", apellidoMaterno: "", lada: "", telefono: "", celular: "" },
      ],
      beneficiario: { nombres: "", apellidoPaterno: "", apellidoMaterno: "", parentesco: "" },
      mejora: { descripcion: "", presupuestoEstimado: null },
    });
    const snap = adaptB3SnapshotToB1(partial);
    assert.equal(snap.cliente.nombres, "");
    assert.equal(snap.cliente.curp, "");
    assert.equal(snap.credito?.plazoAnios, null);
    assert.equal(snap.mejora?.presupuestoEstimado, null);
  });

  it("rechaza schemaVersion distinto de 1", () => {
    assert.throws(
      () => adaptB3SnapshotToB1(b3Payload({ schemaVersion: 2 })),
      (err: unknown) =>
        err instanceof InfonavitSnapshotAdapterError &&
        err.reason === "schema_version",
    );
  });

  it("mappingVersion 2: nombreCompleto + direccionCompleta + monto Mejoravit", () => {
    const p = b3Payload({
      mappingVersion: 2,
      localidad: "NUEVO LEÓN",
      ciudadCierre: "NUEVO LEÓN",
      cliente: {
        nombreCompleto: "RUBEN CASTRO QUIÑONES",
        nombres: "RUBEN",
        apellidoPaterno: "CASTRO",
        apellidoMaterno: "QUIÑONES",
        nss: "18900000001",
        curp: "XAXX010101HDFXXX09",
        rfc: "XAXX010101000",
        celular: "5518900001",
        correo: "cliente.prueba@test.local",
        telefono: "",
        ladaTelefono: "",
        genero: "",
        estadoCivil: "",
        regimenMatrimonial: "",
        identificacion: { tipo: "", numero: "", vigencia: "" },
      },
      vivienda: {
        direccionCompleta: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
        calle: "CALLE PRUEBA",
        noExt: "309",
        noInt: "",
        lote: "",
        manzana: "",
        colonia: "CENTRO",
        entidad: "NUEVO LEÓN",
        municipio: "JUAREZ",
        cp: "67250",
        tipoPropiedad: "",
      },
      credito: { montoSolicitado: 102529.36, plazoAnios: 10 },
      mejora: { descripcion: "Resanes y aplicación de pintura interior y exterior.", presupuestoEstimado: 102529.36 },
    });
    const snap = adaptB3SnapshotToB1(p);
    assert.equal(snap.cliente.nombreCompleto, "RUBEN CASTRO QUIÑONES");
    assert.equal(snap.cliente.nombres, "RUBEN");
    assert.equal(snap.cliente.apellidoPaterno, "CASTRO");
    assert.equal(snap.localidad, "NUEVO LEÓN");
    assert.equal(snap.ciudadCierre, "NUEVO LEÓN");
    assert.equal(snap.vivienda?.calle, "CALLE PRUEBA");
    assert.equal(snap.vivienda?.cp, "67250");
    assert.equal(snap.credito?.montoSolicitado, 102529.36);
    assert.equal(snap.mejora?.presupuestoEstimado, 102529.36);
    assert.notEqual(snap.credito?.montoSolicitado, 113921.51);
    assert.equal(snap.cliente.genero, null);
  });
});

describe("P189 B4 worker auth", () => {
  it("secret vacío o distinto → inválido", () => {
    assert.equal(workerSecretIsValid("", "abc"), false);
    assert.equal(workerSecretIsValid("abc", ""), false);
    assert.equal(workerSecretIsValid("abc", "abd"), false);
  });

  it("secret correcto → válido", () => {
    assert.equal(workerSecretIsValid("local-test-secret", "local-test-secret"), true);
  });
});

describe("P189 B4 generate from B3 payload", () => {
  it("3 PDFs flatten + contenido ficticio + T29=años + T55 vacío", async () => {
    const snapshot = adaptB3SnapshotToB1(b3Payload());

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

    await validateGeneratedInfonavitPdf({
      documentType: "carta_bajo_protesta",
      bytes: carta.bytes,
    });
    await validateGeneratedInfonavitPdf({
      documentType: "presupuesto_mejoramiento",
      bytes: pres.bytes,
    });
    await validateGeneratedInfonavitPdf({
      documentType: "solicitud_inscripcion_credito",
      bytes: sol.bytes,
    });

    const cartaDoc = await PDFDocument.load(carta.bytes);
    const presDoc = await PDFDocument.load(pres.bytes);
    const solDoc = await PDFDocument.load(sol.bytes);
    assert.equal(cartaDoc.getForm().getFields().length, 0);
    assert.equal(presDoc.getForm().getFields().length, 0);
    assert.equal(solDoc.getForm().getFields().length, 0);
    assert.equal(cartaDoc.getPageCount(), 2);
    assert.equal(presDoc.getPageCount(), 1);
    assert.equal(solDoc.getPageCount(), 2);

    assert.equal(carta.fieldsBeforeFlatten[BAJO_FIELD.T8_NOMBRE], "Lopez Perez Ana");
    assert.equal(carta.fieldsBeforeFlatten[BAJO_FIELD.T9_NSS], "18400000001");
    assert.match(
      String(carta.fieldsBeforeFlatten[BAJO_FIELD.T4_DESC0]),
      /Impermeabilizacion/i,
    );

    assert.equal(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T1_NSS], "18400000001");
    assert.match(String(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T9_MONTO]), /25/);

    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T0_NSS], "18400000001");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T5_NOMBRES], "Ana");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T27_MONTO], "150,000.00");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T29_PLAZO], "5");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T55_CREDITO_INFONAVIT_BLANK], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.C0_GENERO_F], true);
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.C1_GENERO_M], false);
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.C8_PROP_PROPIA], true);
  });

  it("mapping v2: carta/presupuesto/solicitud usan Monto Mejoravit y nombre separado", async () => {
    const snapshot = adaptB3SnapshotToB1(
      b3Payload({
        mappingVersion: 2,
        localidad: "NUEVO LEÓN",
        ciudadCierre: "NUEVO LEÓN",
        cliente: {
          nombreCompleto: "RUBEN CASTRO QUIÑONES",
          nombres: "RUBEN",
          apellidoPaterno: "CASTRO",
          apellidoMaterno: "QUIÑONES",
          nss: "18900000001",
          curp: "XAXX010101HDFXXX09",
          rfc: "XAXX010101000",
          celular: "5518900001",
          correo: "cliente.prueba@test.local",
          telefono: "",
          ladaTelefono: "",
          genero: "",
          estadoCivil: "",
          regimenMatrimonial: "",
          identificacion: { tipo: "", numero: "", vigencia: "" },
        },
        vivienda: {
          direccionCompleta: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
          calle: "CALLE PRUEBA",
          noExt: "309",
          noInt: "",
          lote: "",
          manzana: "",
          colonia: "CENTRO",
          entidad: "NUEVO LEÓN",
          municipio: "JUAREZ",
          cp: "67250",
          tipoPropiedad: "",
        },
        credito: { montoSolicitado: 102529.36, plazoAnios: 10 },
        mejora: {
          descripcion:
            "Resanes y aplicación de pintura interior y exterior.\nImpermeabilización y reparación de áreas con humedad.",
          presupuestoEstimado: 102529.36,
        },
      }),
    );

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

    assert.equal(carta.fieldsBeforeFlatten[BAJO_FIELD.T8_NOMBRE], "RUBEN CASTRO QUIÑONES");
    assert.equal(carta.fieldsBeforeFlatten[BAJO_FIELD.T9_NSS], "18900000001");
    assert.equal(carta.fieldsBeforeFlatten[BAJO_FIELD.T0_LOCALIDAD], "NUEVO LEÓN");
    assert.match(
      String(carta.fieldsBeforeFlatten[BAJO_FIELD.T4_DESC0]),
      /Resanes/,
    );

    assert.match(String(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T0_NOMBRE]), /RUBEN/);
    assert.match(String(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T2_DIR0]), /CALLE PRUEBA|67250/);
    assert.equal(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T9_MONTO], "102,529.36");
    assert.notEqual(pres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T9_MONTO], "113,921.51");

    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T5_NOMBRES], "RUBEN");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T3_AP_PATERNO], "CASTRO");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T4_AP_MATERNO], "QUIÑONES");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T27_MONTO], "102,529.36");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T18_CALLE], "CALLE PRUEBA");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T56_CIUDAD], "NUEVO LEÓN");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T55_CREDITO_INFONAVIT_BLANK], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T31_BLANK], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.T49_PROMOTOR_BLANK], "");
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.C0_GENERO_F], false);
    assert.equal(sol.fieldsBeforeFlatten[SOLICITUD_FIELD.C1_GENERO_M], false);
  });
});
