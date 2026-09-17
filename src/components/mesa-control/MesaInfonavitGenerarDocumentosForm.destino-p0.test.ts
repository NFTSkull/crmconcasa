import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildMesaInfonavitGeneratePayload,
  normalizeDestinoRecursosForCapture,
  parseMesaInfonavitDocumentDraft,
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

describe("MesaInfonavitGenerarDocumentosForm P0 destino recursos", () => {
  const formPath = join(
    process.cwd(),
    "src/components/mesa-control/MesaInfonavitGenerarDocumentosForm.tsx",
  );
  const formSrc = readFileSync(formPath, "utf8");

  it("UI ya no muestra % titulación ni CLABE notaría; sí CLABE derechohabiente", () => {
    assert.doesNotMatch(formSrc, /% para titulación/);
    assert.doesNotMatch(formSrc, /CLABE de la notaría/);
    assert.match(formSrc, /CLABE del derechohabiente/);
    assert.match(formSrc, /Monto de crédito solicitado/);
    assert.match(formSrc, /Plazo solicitado \(años\)/);
  });

  it("draft nuevo deja porcentajeTitulacion y clabeNotaria vacíos", () => {
    const d = parseMesaInfonavitDocumentDraft({
      credito: { montoSolicitado: 1, plazoAnios: 2 },
      destinoRecursos: {},
    });
    assert.equal(d.destinoRecursos.porcentajeTitulacion, "");
    assert.equal(d.destinoRecursos.clabeNotaria, "");
    assert.equal(d.destinoRecursos.clabeDerechohabiente, "");
  });

  it("draft/localStorage antiguo no reintroduce T31/T32 y conserva T33", () => {
    const restored = parseMesaInfonavitDocumentDraft({
      destinoRecursos: {
        porcentajeTitulacion: "30",
        clabeNotaria: "012345678901234567",
        clabeDerechohabiente: "111122223333444455",
      },
      credito: { montoSolicitado: 34625.92, plazoAnios: 3 },
    });
    assert.equal(restored.destinoRecursos.porcentajeTitulacion, "");
    assert.equal(restored.destinoRecursos.clabeNotaria, "");
    assert.equal(
      restored.destinoRecursos.clabeDerechohabiente,
      "111122223333444455",
    );
  });

  it("normalizeDestinoRecursosForCapture anula T31/T32 y preserva T33", () => {
    assert.deepEqual(
      normalizeDestinoRecursosForCapture({
        porcentajeTitulacion: "15",
        clabeNotaria: "999999999999999999",
        clabeDerechohabiente: "123456789012345678",
      }),
      {
        porcentajeTitulacion: "",
        clabeNotaria: "",
        clabeDerechohabiente: "123456789012345678",
      },
    );
  });

  it("payload de generación fuerza T31/T32 vacíos sin cambiar T33 ni monto/plazo", () => {
    const draft = minimalDraft({
      porcentajeTitulacion: "30",
      clabeNotaria: "012345678901234567",
      clabeDerechohabiente: "987654321098765432",
    });
    const payload = buildMesaInfonavitGeneratePayload(draft);
    assert.equal(payload.destinoRecursos.porcentajeTitulacion, "");
    assert.equal(payload.destinoRecursos.clabeNotaria, "");
    assert.equal(
      payload.destinoRecursos.clabeDerechohabiente,
      "987654321098765432",
    );
    assert.equal(payload.credito.montoSolicitado, 34625.92);
    assert.equal(payload.credito.plazoAnios, 3);
  });

  it("no toca fill-solicitud T33 ni agenda/citas en este cambio", () => {
    const fillSrc = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/_shared/infonavit-pdf/fill-solicitud.ts",
      ),
      "utf8",
    );
    assert.match(fillSrc, /T33_BLANK/);
    assert.match(fillSrc, /clabeDerechohabiente/);
    assert.doesNotMatch(formSrc, /agenda_sheet|cupo|google.?sheets/i);
  });
});
