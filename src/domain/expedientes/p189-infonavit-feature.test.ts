import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPostgrestFunctionMissing } from "./postgrest-function-missing";
import {
  P189_INFONAVIT_FEATURE_OFF,
  p189BlocksUnsavedClienteDatos,
  parseP189InfonavitFeatureStatus,
  shouldShowAsesorInfonavitDatosFields,
} from "./p189-infonavit-feature";
import { getClienteDatosCamposFaltantes } from "@/lib/clienteDatosFormCompleteness";
import { validateClienteDatos } from "@/lib/clienteDatosValidation";
import { fixtureInfonavitCompleto } from "@/domain/expediente-cliente-datos/infonavit-datos.fixtures";
import { emptyInfonavitClienteDatosV1 } from "@/domain/expediente-cliente-datos/infonavit-datos";
import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";
import { shouldShowInfonavitPdfSection } from "@/domain/expediente-archivos/infonavit-pdf-estado";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const legacyCompleto: ClienteDatosFormShape = {
  nombreCliente: "Juan Pérez",
  nss: "12345678901",
  curp: "PEGJ850101HDFRRN09",
  rfc: "PEGJ850101ABC",
  celular: "8119087564",
  correo: "juan@ejemplo.mx",
  empresa: "ACME SA",
  registroPatronal: "A1234567890",
  telefonoEmpresa: "8187654321",
  referencias: [
    { nombre: "Ref Uno", celular: "8111111111" },
    { nombre: "Ref Dos", celular: "8222222222" },
  ],
  beneficiario: { nombre: "María", parentesco: "Hermana" },
  direccionEmpresa: {
    calle: "C1",
    colonia: "Col",
    municipio: "Mun",
    cp: "64000",
  },
  montoMejoravit: "150000",
  plazo: "5",
  porcentajeCobro: "10",
  montoCalculado: "15000",
  metodoPago: "transferencia",
};

describe("P189 B7 feature status + PGRST202", () => {
  it("parse default OFF", () => {
    assert.deepEqual(parseP189InfonavitFeatureStatus(null), P189_INFONAVIT_FEATURE_OFF);
    assert.equal(parseP189InfonavitFeatureStatus({ aplica: true }).required, false);
  });

  it("parse required nuevo", () => {
    const s = parseP189InfonavitFeatureStatus({
      aplica: true,
      feature_active: true,
      legacy: false,
      required: true,
      has_complete_v1: false,
    });
    assert.equal(s.required, true);
    assert.equal(s.legacy, false);
    assert.equal(p189BlocksUnsavedClienteDatos(s), true);
  });

  it("legacy ON incompleto no bloquea unsaved", () => {
    const s = parseP189InfonavitFeatureStatus({
      aplica: true,
      feature_active: true,
      legacy: true,
      required: false,
      has_complete_v1: false,
    });
    assert.equal(p189BlocksUnsavedClienteDatos(s), false);
  });

  it("legacy ON completo sí bloquea unsaved (enqueue)", () => {
    const s = parseP189InfonavitFeatureStatus({
      aplica: true,
      feature_active: true,
      legacy: true,
      required: false,
      has_complete_v1: true,
    });
    assert.equal(p189BlocksUnsavedClienteDatos(s), true);
  });

  it("PGRST202 function missing → fallback OFF", () => {
    assert.equal(
      isPostgrestFunctionMissing({
        code: "PGRST202",
        message: "Could not find the function public.get_p189_infonavit_feature_status in the schema cache",
      }),
      true,
    );
  });

  it("function not found PGRST → missing", () => {
    assert.equal(
      isPostgrestFunctionMissing({
        code: "PGRST205",
        message: "Could not find the function public.get_expediente_infonavit_pdf_estado",
      }),
      true,
    );
  });

  it("42501 / 401 / network NO son missing", () => {
    assert.equal(
      isPostgrestFunctionMissing({ code: "42501", message: "permission denied" }),
      false,
    );
    assert.equal(
      isPostgrestFunctionMissing({ code: "401", message: "JWT expired" }),
      false,
    );
    assert.equal(
      isPostgrestFunctionMissing({ code: "PGRST301", message: "network" }),
      false,
    );
    assert.equal(
      isPostgrestFunctionMissing({ message: "Failed to fetch" }),
      false,
    );
  });
});

describe("P189 B7 completeness dual", () => {
  it("FLAG OFF: Mejoravit legacy completo no lista 50 campos P189", () => {
    const m = getClienteDatosCamposFaltantes(legacyCompleto, {
      montoAprobado: 150_000,
      direccionOpcional: "Calle Real 1",
      programaDb: "mejoravit",
      requireInfonavit: false,
    });
    assert.deepEqual(m, []);
  });

  it("FLAG ON nuevo: incompleto P189 bloquea", () => {
    const m = getClienteDatosCamposFaltantes(legacyCompleto, {
      montoAprobado: 150_000,
      direccionOpcional: "Calle Real 1",
      programaDb: "mejoravit",
      requireInfonavit: true,
    });
    assert.ok(m.length > 0);
    assert.ok(m.some((x) => x.includes("Nombre(s)") || x.includes("Calle de la vivienda")));
  });

  it("FLAG ON nuevo completo permite", () => {
    const m = getClienteDatosCamposFaltantes(
      { ...legacyCompleto, infonavit: fixtureInfonavitCompleto() },
      {
        montoAprobado: 150_000,
        direccionOpcional: "",
        programaDb: "mejoravit",
        requireInfonavit: true,
      },
    );
    assert.deepEqual(m, []);
  });
});

describe("P189 B7 validation optional vs required", () => {
  it("FLAG OFF: legacy completo sin infonavit es válido", () => {
    const r = validateClienteDatos(legacyCompleto, {
      montoAprobado: 150_000,
      direccionOpcional: "Calle Real 1",
      programaDb: "mejoravit",
      requireInfonavit: false,
    });
    assert.equal(r.isValid, true);
    assert.equal(r.errors.infonavitTitularNombres, undefined);
  });

  it("FLAG OFF: CP infonavit presente inválido sí falla formato", () => {
    const r = validateClienteDatos(
      {
        ...legacyCompleto,
        infonavit: fixtureInfonavitCompleto({
          vivienda: { ...fixtureInfonavitCompleto().vivienda, cp: "12" },
        }),
      },
      {
        montoAprobado: 150_000,
        direccionOpcional: "Calle Real 1",
        programaDb: "mejoravit",
        requireInfonavit: false,
      },
    );
    assert.equal(r.isValid, false);
    assert.ok(r.errors.infonavitViviendaCp);
  });

  it("FLAG ON: incompleto P189 inválido", () => {
    const r = validateClienteDatos(legacyCompleto, {
      montoAprobado: 150_000,
      direccionOpcional: "Calle Real 1",
      programaDb: "mejoravit",
      requireInfonavit: true,
    });
    assert.equal(r.isValid, false);
    assert.ok(r.errors.infonavitTitularNombres);
  });
});

describe("P189 B7 B5 missing RPC hides section", () => {
  it("has_submission false no muestra accordion", () => {
    assert.equal(
      shouldShowInfonavitPdfSection({ aplica: true, has_submission: false }),
      false,
    );
  });
});

describe("P189 B7.1 UX freeze — cuándo renderizar formulario P189", () => {
  const off: typeof P189_INFONAVIT_FEATURE_OFF = {
    ...P189_INFONAVIT_FEATURE_OFF,
    aplica: true,
  };
  const legacyOn = {
    aplica: true,
    feature_active: true,
    legacy: true,
    required: false,
    has_complete_v1: false,
  };
  const nuevoRequired = {
    aplica: true,
    feature_active: true,
    legacy: false,
    required: true,
    has_complete_v1: false,
  };

  it("flag OFF + Mejoravit → NO render", () => {
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: off,
        infonavit: emptyInfonavitClienteDatosV1(),
      }),
      false,
    );
  });

  it("flag ON + legacy sin v1 capturado → NO render", () => {
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: legacyOn,
        infonavit: emptyInfonavitClienteDatosV1(),
      }),
      false,
    );
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: legacyOn,
        infonavit: undefined,
      }),
      false,
    );
  });

  it("flag ON + legacy con v1 capturado → render opcional (no pierde datos)", () => {
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: { ...legacyOn, has_complete_v1: true },
        infonavit: fixtureInfonavitCompleto(),
      }),
      true,
    );
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: { ...nuevoRequired, required: false, legacy: true },
        infonavit: fixtureInfonavitCompleto(),
      }),
      true,
    );
  });

  it("flag ON + nuevo required → render", () => {
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: nuevoRequired,
        infonavit: emptyInfonavitClienteDatosV1(),
      }),
      true,
    );
  });

  it("non-Mejoravit / status OFF → NO render", () => {
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: P189_INFONAVIT_FEATURE_OFF,
        infonavit: fixtureInfonavitCompleto(),
      }),
      false,
    );
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: null,
        infonavit: fixtureInfonavitCompleto(),
      }),
      false,
    );
  });

  it("Mesa/asesor has_submission=false → NO sección PDF", () => {
    assert.equal(
      shouldShowInfonavitPdfSection({ aplica: true, has_submission: false }),
      false,
    );
    assert.equal(
      shouldShowInfonavitPdfSection({ aplica: false, has_submission: false }),
      false,
    );
  });

  it("formulario solo monta AsesorInfonavitDatosGeneralesFields si showInfonavitDatosFields", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/asesor/ExpedienteClienteDatosFormSection.tsx"),
      "utf8",
    );
    assert.match(src, /showInfonavitDatosFields \? \(/);
    assert.match(src, /<AsesorInfonavitDatosGeneralesFields/);
    assert.match(src, /showInfonavitDatosFields = false/);
    const pageSrc = readFileSync(
      join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
      "utf8",
    );
    assert.match(pageSrc, /showInfonavitDatosFields=\{showInfonavitDatosFields\}/);
    assert.match(pageSrc, /shouldShowAsesorInfonavitDatosFields/);
  });

  it("B7.1.1 heading empresa: FLAG OFF / legacy sin v1 / non-Mejoravit = copy pre-P189", () => {
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: off,
        infonavit: emptyInfonavitClienteDatosV1(),
      }),
      false,
    );
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: legacyOn,
        infonavit: emptyInfonavitClienteDatosV1(),
      }),
      false,
    );
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: {
          aplica: false,
          feature_active: true,
          legacy: false,
          required: false,
          has_complete_v1: false,
        },
        infonavit: fixtureInfonavitCompleto(),
      }),
      false,
    );
    assert.equal(
      shouldShowAsesorInfonavitDatosFields({
        status: nuevoRequired,
        infonavit: emptyInfonavitClienteDatosV1(),
      }),
      true,
    );

    const src = readFileSync(
      join(process.cwd(), "src/components/asesor/ExpedienteClienteDatosFormSection.tsx"),
      "utf8",
    );
    assert.match(
      src,
      /showInfonavitDatosFields\s*\n\s*\? "C\. Datos laborales \/ Dirección de la empresa"\s*\n\s*: "Dirección de la empresa"/,
    );
    assert.doesNotMatch(
      src,
      /<p className="text-xs font-semibold text-gray-900">C\. Datos laborales \/ Dirección de la empresa<\/p>/,
    );
    assert.match(src, /<AsesorInfonavitDatosGeneralesFields/);
    assert.match(src, /showInfonavitDatosFields \? \(/);
  });
});
