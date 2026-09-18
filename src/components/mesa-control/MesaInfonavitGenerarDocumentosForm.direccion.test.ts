import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildMesaInfonavitGeneratePayload,
  composeMesaInfonavitDireccionCompleta,
  hasMesaInfonavitDireccionForGenerate,
  MESA_INFONAVIT_DIRECCION_REQUERIDA_MSG,
  parseMesaInfonavitDocumentDraft,
} from "./MesaInfonavitGenerarDocumentosForm";

describe("Mesa INFONAVIT — dirección de propuesta", () => {
  it("compone direccionCompleta desde los campos visibles de Vivienda a mejorar", () => {
    const draft = parseMesaInfonavitDocumentDraft({
      vivienda: {
        direccionCompleta: "LEGACY QUE NO DEBE MANDAR",
        calle: "AV. LAS TORRES",
        noExt: "123",
        noInt: "4B",
        lote: "7",
        manzana: "12",
        colonia: "CENTRO",
        municipio: "MONTERREY",
        entidad: "NUEVO LEÓN",
        cp: "64000",
      },
      credito: { montoSolicitado: 100000, plazoAnios: 5 },
    });

    const direccion = composeMesaInfonavitDireccionCompleta(draft.vivienda);
    assert.equal(
      direccion,
      "AV. LAS TORRES, No. 123, Int. 4B, Lote 7, Mz. 12, Col. CENTRO, MONTERREY, NUEVO LEÓN, CP 64000",
    );

    const payload = buildMesaInfonavitGeneratePayload(draft);
    assert.equal(payload.vivienda.direccionCompleta, direccion);
  });

  it("conserva direccionCompleta legacy si no hay campos estructurados", () => {
    const draft = parseMesaInfonavitDocumentDraft({
      vivienda: {
        direccionCompleta: "  CALLE LEGACY 55, COL. CENTRO  ",
      },
    });
    assert.equal(
      composeMesaInfonavitDireccionCompleta(draft.vivienda),
      "CALLE LEGACY 55, COL. CENTRO",
    );
    assert.equal(hasMesaInfonavitDireccionForGenerate(draft.vivienda), true);
  });

  it("detecta dirección totalmente vacía y la UI la exige antes de generar", () => {
    const draft = parseMesaInfonavitDocumentDraft({ vivienda: {} });
    assert.equal(hasMesaInfonavitDireccionForGenerate(draft.vivienda), false);
    assert.match(MESA_INFONAVIT_DIRECCION_REQUERIDA_MSG, /dirección/i);

    const formSrc = readFileSync(
      join(
        process.cwd(),
        "src/components/mesa-control/MesaInfonavitGenerarDocumentosForm.tsx",
      ),
      "utf8",
    );
    assert.match(
      formSrc,
      /hasMesaInfonavitDireccionForGenerate\(draft\.vivienda\)/,
    );
    assert.match(formSrc, /dirección de la vivienda/);
  });
});
