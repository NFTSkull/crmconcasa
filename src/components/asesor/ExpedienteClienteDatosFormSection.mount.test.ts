import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ExpedienteClienteDatosFormSection capturaVariant", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/asesor/ExpedienteClienteDatosFormSection.impl.tsx"),
    "utf8",
  );
  const wrapper = readFileSync(
    join(process.cwd(), "src/components/asesor/ExpedienteClienteDatosFormSection.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );

  it("declara prop capturaVariant y data-captura-variant", () => {
    assert.match(src, /capturaVariant\?: ClienteDatosCapturaVariant/);
    assert.match(src, /data-captura-variant=\{capturaVariant\}/);
    assert.match(src, /esSimplificado = capturaVariant === "simplificado"/);
  });

  it("wrapper fuerza completo cuando el dueño requiere teléfono casa", () => {
    assert.match(wrapper, /props\.showTelefonoCasa\s*\?\s*"completo"/);
    assert.match(wrapper, /capturaVariant=\{capturaVariant\}/);
  });

  it("simplificado omite CURP piloto, RFC, refs/beneficiario y plazo", () => {
    assert.match(src, /\{!esSimplificado && expedienteId \? \([\s\S]*AsesorCurpValidacionSection/);
    assert.match(src, /\{!esSimplificado \? \([\s\S]*Referencias/);
    assert.match(src, /Celular del cliente \(obligatorio\)/);
  });

  it("página: vista por actor, checklist por dueño UUID (paquete externos SQL)", () => {
    assert.match(page, /actorPaqueteExternos/);
    assert.match(page, /duenoPaqueteExternos/);
    assert.match(page, /asesorProfileId/);
    assert.match(page, /perfilCaptura: perfilCapturaClienteDatos/);
    assert.match(page, /capturaVariant=\{capturaVariantClienteDatos\}/);
    assert.match(page, /showTelefonoCasa=\{requiereTelefonoCasa\}/);
    assert.match(page, /resolveClienteDatosPerfilCaptura/);
    assert.match(page, /fetchAsesorEsPaqueteDocumentalExternos/);
    assert.match(page, /fetchAsesorDocumentosObligatoriosEnvio/);
  });

  it("página: gate paquete nuevo Silvia (membresía ∧ rollout) → mostrarClabe", () => {
    assert.match(page, /fetchAsesorEquipoSilviaPaqueteNuevoHabilitado/);
    assert.match(page, /fetchAsesorEnEquipoPorLiderEmail/);
    assert.match(page, /isSilviaPaqueteNuevoGate/);
    assert.match(page, /esPaqueteNuevoSilvia/);
    assert.match(page, /mostrarClabe=\{mostrarClabePaqueteNuevo\}/);
  });

  it("formulario declara prop mostrarClabe y campo CLABE", () => {
    assert.match(src, /mostrarClabe\?: boolean/);
    assert.match(src, /CLABE \(opcional\)/);
    assert.match(src, /filterDigitsInput\(e\.target\.value, 18\)/);
  });

  it("showTelefonoCasa prop cableada al CURP wrapper", () => {
    assert.match(src, /showTelefonoCasa\?: boolean/);
    assert.match(src, /showTelefonoCasa=\{showTelefonoCasa\}/);
    assert.match(src, /telefonoCasaValue=\{telefonoCasaValue\}/);
  });

  it("página: restore automático de borrador + flush síncrono + dirty guard", () => {
    assert.match(page, /autoRestoreClienteDatosDraftIfPending/);
    assert.match(page, /shouldSkipClienteDatosOfficialRehydrate/);
    assert.match(page, /flushClienteDatosDraftSnapshot/);
    assert.match(page, /syncClienteDatosDraftFlush/);
    assert.match(page, /writeClienteDatosDraftImmediate/);
    assert.match(page, /clienteDatosSavedPreservesCapture/);
    assert.match(page, /suppressClienteDatosRemoteHydrationRef/);
    assert.doesNotMatch(page, /Restaurar borrador/);
    assert.match(src, /Borrador recuperado automáticamente/);
    assert.match(src, /Borrador guardado automáticamente/);
  });
});

describe("ExpedienteClienteDatosFormSection panel histórico refs", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/asesor/ExpedienteClienteDatosFormSection.impl.tsx"),
    "utf8",
  );

  it("legacyGrandfathered muestra nombre+celular exactos siempre (no solo ambiguos)", () => {
    assert.match(src, /showLegacyHistorico = refActual\?\.legacyGrandfathered === true/);
    assert.match(src, /referencia-legacy-nombre-/);
    assert.match(src, /referencia-legacy-celular-/);
    assert.match(src, /Nombre completo/);
    assert.match(src, /Esta referencia fue capturada antes del formato/);
    assert.match(src, /registro histórico/);
    assert.doesNotMatch(
      src,
      /legacyGrandfathered === true &&\s*![\s\S]{0,80}apellidoPaterno/,
    );
  });

  it("externo/simplificado no monta bloque Referencias", () => {
    assert.match(src, /\{!esSimplificado \? \([\s\S]*Referencias/);
  });

  it("updateRef sigue limpiando legacyGrandfathered al editar", () => {
    assert.match(src, /delete merged\.legacyGrandfathered/);
  });
});


it("página: borrador local solo restaura si es posterior al cliente_datos oficial", () => {
  assert.match(
    page,
    /autoRestoreClienteDatosDraftIfPending\([\s\S]*?found\.updatedAt/,
  );
  assert.match(
    page,
    /shouldAutoRestoreClienteDatosDraft\([\s\S]*?officialUpdatedAt/,
  );
});
