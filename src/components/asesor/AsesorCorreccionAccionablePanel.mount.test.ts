import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ASESOR_SECCION_DG_ID,
  ASESOR_SECCION_DOCS_ID,
  ASESOR_SECCION_RETENCION_ID,
} from "@/domain/expedientes/asesor-expediente-correccion-ui";
import {
  correccionItemCtaLabel,
  correccionItemFocusId,
  type AsesorCorreccionItem,
} from "@/domain/expedientes/asesor-correccion-detalle";

describe("P210 T18 — action_target / anchors", () => {
  const panel = readFileSync(
    join(process.cwd(), "src/components/asesor/AsesorCorreccionAccionablePanel.tsx"),
    "utf8",
  );
  const detallePage = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );

  const dgItem: AsesorCorreccionItem = {
    type: "datos_generales",
    key: "datos_generales",
    label: "Datos generales",
    motivo: "RFC DEL EDC NO EXISTE",
    action_target: "datos_generales",
    local_status: "pendiente",
  };

  const docItem: AsesorCorreccionItem = {
    type: "documento",
    key: "cliente_estado_cuenta",
    label: "Estado de cuenta",
    motivo: "ACTUALIZAR EDC",
    action_target: "cliente_estado_cuenta",
    local_status: "pendiente",
  };

  const retItem: AsesorCorreccionItem = {
    type: "retencion",
    key: "retencion",
    label: "Retención",
    motivo: "ACTUALIZAR ACUSE",
    action_target: "retencion",
    local_status: "pendiente",
  };

  it("T18 DG → CTA Ir a Datos generales + anchor DG", () => {
    assert.equal(correccionItemCtaLabel(dgItem), "Ir a Datos generales");
    assert.equal(correccionItemFocusId(dgItem), ASESOR_SECCION_DG_ID);
    assert.match(panel, /correccionItemCtaLabel\(item\)/);
    assert.match(panel, /correccionItemFocusId\(item\)/);
    assert.match(panel, /onFocusSection\?\.\(correccionItemFocusId\(item\)\)/);
  });

  it("T18 documento → CTA Ir al documento + anchor docs", () => {
    assert.equal(correccionItemCtaLabel(docItem), "Ir al documento");
    assert.equal(correccionItemFocusId(docItem), ASESOR_SECCION_DOCS_ID);
  });

  it("T18 retención → CTA Ir a Retención + anchor retención", () => {
    assert.equal(correccionItemCtaLabel(retItem), "Ir a Retención");
    assert.equal(correccionItemFocusId(retItem), ASESOR_SECCION_RETENCION_ID);
  });

  it("T18 detalle expone secciones ancla en DOM", () => {
    assert.match(detallePage, /id=\{ASESOR_SECCION_DG_ID\}/);
    assert.match(detallePage, /id=\{ASESOR_SECCION_DOCS_ID\}/);
    assert.match(detallePage, /id=\{ASESOR_SECCION_RETENCION_ID\}/);
    assert.match(detallePage, /AsesorCorreccionAccionablePanel/);
    assert.match(detallePage, /onFocusSection/);
  });
});
