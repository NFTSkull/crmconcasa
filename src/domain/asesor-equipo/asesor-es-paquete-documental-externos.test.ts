import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseAsesorEsPaqueteDocumentalExternos,
  parseAsesorEsPaqueteDocumentalExternosClasificacion,
} from "./asesor-es-paquete-documental-externos";
import {
  resolveClienteDatosCapturaVariant,
  resolveClienteDatosPerfilCaptura,
} from "./asesor-en-equipo-por-lider-email";
import {
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  integrationDocsCompletos,
} from "@/domain/expediente-archivos/integration-docs-completos";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS } from "@/domain/expediente-archivos/asesor-documentos-obligatorios-envio";
import type { IntegrationDocsResumenInput } from "@/domain/expediente-archivos/integration-docs-completos";

describe("parseAsesorEsPaqueteDocumentalExternos", () => {
  it("solo true literal", () => {
    assert.equal(parseAsesorEsPaqueteDocumentalExternos(true), true);
    assert.equal(parseAsesorEsPaqueteDocumentalExternos(false), false);
    assert.equal(parseAsesorEsPaqueteDocumentalExternos("true"), false);
    assert.equal(parseAsesorEsPaqueteDocumentalExternos(1), false);
    assert.equal(parseAsesorEsPaqueteDocumentalExternos(null), false);
  });

  it("tri-state: true→externo false→interno resto→unknown", () => {
    assert.equal(
      parseAsesorEsPaqueteDocumentalExternosClasificacion(true),
      "externo",
    );
    assert.equal(
      parseAsesorEsPaqueteDocumentalExternosClasificacion(false),
      "interno",
    );
    assert.equal(
      parseAsesorEsPaqueteDocumentalExternosClasificacion(null),
      "unknown",
    );
    assert.equal(
      parseAsesorEsPaqueteDocumentalExternosClasificacion("true"),
      "unknown",
    );
  });

  it("perfil/captura: unknown ≠ interno; resolving → simplificado UI", () => {
    assert.equal(
      resolveClienteDatosPerfilCaptura({ duenoClasificacion: "unknown" }),
      "clasificacion_pendiente",
    );
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorClasificacionResuelta: false,
      }),
      "simplificado",
    );
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorClasificacion: "unknown",
        actorClasificacionResuelta: true,
      }),
      "simplificado",
    );
  });
});

describe("Datos Generales: paquete externos (Silvia|Orlando)", () => {
  it("dueño externo → perfil simplificado histórico; ajeno/null → completo", () => {
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: true,
      }),
      "asesor_equipo_silvia_simplificado",
    );
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: false,
      }),
      "asesor_completo",
    );
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: null,
      }),
      "asesor_completo",
    );
  });

  it("actor externo → vista simplificada; fail-closed → completo", () => {
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: true,
      }),
      "simplificado",
    );
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: false,
      }),
      "completo",
    );
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: undefined,
      }),
      "completo",
    );
  });
});

describe("actor/dueño matrix A/B/C/D", () => {
  function checklistForOwner(ownerExterno: boolean) {
    const tipos = ownerExterno
      ? INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS
      : INTEGRATION_DOC_TIPOS_ASESOR_ENVIO;
    const resumen: IntegrationDocsResumenInput = tipos.map((tipo) => ({
      tipo_documento: tipo as IntegrationDocsResumenInput[number]["tipo_documento"],
      estatus_revision: "subido",
    }));
    return {
      tipos,
      checklist: deriveIntegrationDocsChecklist(resumen, tipos),
      presentes: countIntegrationDocsPresentes(resumen, tipos),
      completos: integrationDocsCompletos(resumen, tipos),
      vista: resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: false, // overwritten per case
      }),
    };
  }

  it("A) actor externo + dueño externo → vista simplificada + checklist 8", () => {
    const owner = checklistForOwner(true);
    assert.equal(owner.tipos.length, INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS.length);
    assert.equal(owner.presentes, INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS.length);
    assert.equal(owner.completos, true);
    assert.ok(!owner.checklist.some((i) => i.tipo_documento === "cliente_ine_reverso"));
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: true,
      }),
      "simplificado",
    );
  });

  it("B) actor interno + dueño externo → actor completo, expediente exige 8", () => {
    const owner = checklistForOwner(true);
    assert.equal(owner.tipos.length, INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS.length);
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: false,
      }),
      "completo",
    );
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: true,
      }),
      "asesor_equipo_silvia_simplificado",
    );
  });

  it("C) actor externo + dueño interno → expediente exige 4; dueño no se convierte", () => {
    const owner = checklistForOwner(false);
    assert.equal(owner.tipos.length, 4);
    assert.ok(owner.checklist.some((i) => i.tipo_documento === "cliente_ine_reverso"));
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: true,
      }),
      "simplificado",
    );
    assert.equal(
      resolveClienteDatosPerfilCaptura({
        duenoEnPaqueteExternosConfirmado: false,
      }),
      "asesor_completo",
    );
  });

  it("D) actor interno + dueño interno → histórico 4 + formulario completo", () => {
    const owner = checklistForOwner(false);
    assert.equal(owner.tipos.length, 4);
    assert.equal(owner.presentes, 4);
    assert.equal(
      resolveClienteDatosCapturaVariant({
        actorEnPaqueteExternosConfirmado: false,
      }),
      "completo",
    );
  });
});

describe("page wiring Parte B (mount)", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );

  it("fetch documentos por owner + actor/dueño externos; sin hardcode Silvia en esta decisión", () => {
    assert.match(page, /fetchAsesorDocumentosObligatoriosEnvio/);
    assert.match(page, /fetchAsesorEsPaqueteDocumentalExternos/);
    assert.match(page, /tiposEnvioObligatorios/);
    assert.match(page, /actorPaqueteExternos/);
    assert.match(page, /duenoPaqueteExternos/);
    assert.match(page, /asesorProfileId/);
    assert.doesNotMatch(
      page,
      /fetchAsesorEnEquipoPorLiderEmail\(\{\s*leaderEmail:\s*EQUIPO_LIDER_EMAIL_SILVIA_REYES/,
    );
  });

  it("progreso dinámico usa tiposEnvioObligatorios.length", () => {
    assert.match(page, /tiposEnvioObligatorios\.length/);
    assert.doesNotMatch(
      page,
      /Progreso obligatorio:[\s\S]{0,80}INTEGRATION_DOC_TIPOS_ASESOR_ENVIO\.length/,
    );
  });

  it("opcionales extra gated por actorPaqueteExternos + resolved (no length===7)", () => {
    assert.match(page, /actorPaqueteExternos/);
    assert.match(page, /actorPaqueteExternosResolved/);
    assert.match(page, /filterIntegracionChecklistOpcionalesParaActor/);
    assert.doesNotMatch(page, /tiposEnvioObligatorios\.length\s*===\s*7/);
    assert.doesNotMatch(page, /tiposEnvio\.length\s*===\s*7/);
  });
});
