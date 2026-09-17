import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildMesaInfonavitGeneratePayload,
  MESA_CLABE_DERECHOHABIENTE_INVALID_MSG,
  parseMesaInfonavitDocumentDraft,
  validateClabeDerechohabienteForGenerate,
  type MesaInfonavitDocumentDraft,
} from "./MesaInfonavitGenerarDocumentosForm";

function minimalDraft(
  destino: MesaInfonavitDocumentDraft["destinoRecursos"],
): MesaInfonavitDocumentDraft {
  return {
    schemaVersion: 1,
    mappingVersion: 3,
    fechaDocumento: "2026-09-17",
    localidad: "NUEVO LEÓN",
    ciudadCierre: "NUEVO LEÓN",
    cliente: {
      nombreCompleto: "A B C",
      nombres: "A",
      apellidoPaterno: "B",
      apellidoMaterno: "C",
      nss: "12345678901",
      curp: "",
      rfc: "",
      celular: "",
      telefono: "",
      ladaTelefono: "",
      correo: "",
      genero: "",
      estadoCivil: "",
      regimenMatrimonial: "",
      identificacion: { tipo: "", numero: "", vigencia: "" },
    },
    empresa: {
      nombre: "EMPRESA",
      registroPatronal: "A123",
      lada: "",
      telefono: "",
      extension: "",
    },
    vivienda: {
      direccionCompleta: "",
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
    credito: { montoSolicitado: 34625.92, plazoAnios: 3 },
    destinoRecursos: destino,
    referencias: [
      {
        apellidoPaterno: "",
        apellidoMaterno: "",
        nombres: "",
        lada: "",
        telefono: "",
        celular: "",
      },
      {
        apellidoPaterno: "",
        apellidoMaterno: "",
        nombres: "",
        lada: "",
        telefono: "",
        celular: "",
      },
    ],
    beneficiario: {
      parentesco: "HIJO",
      apellidoPaterno: "",
      apellidoMaterno: "",
      nombres: "X",
    },
    mejora: { descripcion: "", presupuestoEstimado: null },
  };
}

describe("Mesa Infonavit P1 CLABE checksum", () => {
  it("vacío permitido al generar", () => {
    const r = validateClabeDerechohabienteForGenerate("");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.normalized, "");
  });

  it("CLABE válida permitida (también con espacios)", () => {
    const r = validateClabeDerechohabienteForGenerate("0321 8000 0118 3597 19");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.normalized, "032180000118359719");
  });

  it("checksum inválido bloquea generación", () => {
    const r = validateClabeDerechohabienteForGenerate("012345678901234567");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.message, MESA_CLABE_DERECHOHABIENTE_INVALID_MSG);
  });

  it("draft antiguo con checksum inválido NO se borra al restaurar", () => {
    const restored = parseMesaInfonavitDocumentDraft({
      destinoRecursos: {
        porcentajeTitulacion: "30",
        clabeNotaria: "012345678901234567",
        clabeDerechohabiente: "012345678901234567",
      },
    });
    assert.equal(restored.destinoRecursos.clabeDerechohabiente, "012345678901234567");
    assert.equal(restored.destinoRecursos.porcentajeTitulacion, "");
    assert.equal(restored.destinoRecursos.clabeNotaria, "");
  });

  it("payload: T31/T32 vacíos; T33 normalizada si válida", () => {
    const draft = minimalDraft({
      porcentajeTitulacion: "10",
      clabeNotaria: "999999999999999999",
      clabeDerechohabiente: "0321-8000-0118-3597-19",
    });
    const payload = buildMesaInfonavitGeneratePayload(draft);
    assert.equal(payload.destinoRecursos.porcentajeTitulacion, "");
    assert.equal(payload.destinoRecursos.clabeNotaria, "");
    assert.equal(
      payload.destinoRecursos.clabeDerechohabiente,
      "032180000118359719",
    );
  });

  it("fill-solicitud sigue consumiendo clabeDerechohabiente (T33)", () => {
    const fillSrc = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/_shared/infonavit-pdf/fill-solicitud.ts",
      ),
      "utf8",
    );
    assert.match(fillSrc, /T33_BLANK/);
    assert.match(fillSrc, /clabeDerechohabiente/);
  });

  it("onChange NO limpia letras ni puntos silenciosamente (regresión)", () => {
    const formSrc = readFileSync(
      join(
        process.cwd(),
        "src/components/mesa-control/MesaInfonavitGenerarDocumentosForm.tsx",
      ),
      "utf8",
    );
    // El campo CLABE debe pasar el valor crudo al updater (sin replace que borre basura).
    assert.match(
      formSrc,
      /label="CLABE del derechohabiente"[\s\S]*?onChange=\{\(v\) => updateDestinoClabeDerechohabiente\(v\)\}/,
    );
    assert.doesNotMatch(
      formSrc,
      /updateDestinoClabeDerechohabiente\(\s*v\.replace/,
    );

    assert.equal(
      validateClabeDerechohabienteForGenerate("03218000011835971A").ok,
      false,
    );
    assert.equal(
      validateClabeDerechohabienteForGenerate("0321.8000.0118.3597.19").ok,
      false,
    );
    assert.equal(
      validateClabeDerechohabienteForGenerate("0321 8000 0118 3597 19").ok,
      true,
    );
    assert.equal(
      validateClabeDerechohabienteForGenerate("0321-8000-0118-3597-19").ok,
      true,
    );

    // Valor con letra se conserva en draft (no se “arregla” al parsear destino).
    const withLetter = parseMesaInfonavitDocumentDraft({
      destinoRecursos: { clabeDerechohabiente: "03218000011835971A" },
    });
    assert.equal(
      withLetter.destinoRecursos.clabeDerechohabiente,
      "03218000011835971A",
    );
    assert.equal(withLetter.destinoRecursos.porcentajeTitulacion, "");
    assert.equal(withLetter.destinoRecursos.clabeNotaria, "");

    const payload = buildMesaInfonavitGeneratePayload(
      minimalDraft({
        porcentajeTitulacion: "",
        clabeNotaria: "",
        clabeDerechohabiente: "0321-8000-0118-3597-19",
      }),
    );
    assert.equal(payload.destinoRecursos.porcentajeTitulacion, "");
    assert.equal(payload.destinoRecursos.clabeNotaria, "");
    assert.equal(
      payload.destinoRecursos.clabeDerechohabiente,
      "032180000118359719",
    );
  });
});
