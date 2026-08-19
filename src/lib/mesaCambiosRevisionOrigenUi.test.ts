import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapMesaCambiosSubfiltroToRpc,
  matchesMesaCambiosSubfiltro,
  mesaAsesorCambiosLoteVacioTitulo,
  mesaCambioOrigenBadge,
  mesaCambioRequestTypeLabel,
  mesaCambioCtaRevisarLabel,
  normalizeMesaCambioRevisionOrigen,
} from "./mesaCambiosRevisionOrigenUi";

describe("mesaCambiosRevisionOrigenUi", () => {
  it("normaliza origins conocidos", () => {
    assert.equal(
      normalizeMesaCambioRevisionOrigen("ADVISOR_UPDATE"),
      "ADVISOR_UPDATE",
    );
    assert.equal(normalizeMesaCambioRevisionOrigen("nope"), null);
  });

  it("labels humanos sin enum crudo", () => {
    assert.equal(
      mesaCambioRequestTypeLabel("SOLICITUD_DATOS_GENERALES"),
      "Datos generales",
    );
    assert.equal(mesaCambioRequestTypeLabel("SOLICITUD_DOCUMENTAL"), "Documento");
    assert.equal(
      mesaCambioRequestTypeLabel("RECHAZO_OPERATIVO_CON_CORRECCION"),
      "Revisión operativa",
    );
    assert.equal(
      mesaCambioOrigenBadge("REQUESTED_CORRECTION"),
      "Corrección por revisar",
    );
    assert.equal(
      mesaCambioOrigenBadge("ADVISOR_UPDATE"),
      "Actualización del asesor",
    );
  });

  it("lote vacío origin-aware (Natividad-like)", () => {
    assert.equal(
      mesaAsesorCambiosLoteVacioTitulo("ADVISOR_UPDATE"),
      "Actualización enviada sin detalle de cambios disponible",
    );
    assert.doesNotMatch(
      mesaAsesorCambiosLoteVacioTitulo("ADVISOR_UPDATE"),
      /Corrección enviada sin cambios detectables/,
    );
    assert.doesNotMatch(
      mesaAsesorCambiosLoteVacioTitulo("ADVISOR_UPDATE"),
      /Corrección solicitada/,
    );
    assert.match(
      mesaAsesorCambiosLoteVacioTitulo("REQUESTED_CORRECTION"),
      /Corrección reenviada/,
    );
  });

  it("copy de colas y CTA sin enums internos", () => {
    assert.equal(
      mesaCambioCtaRevisarLabel("REQUESTED_CORRECTION"),
      "Revisar corrección",
    );
    assert.equal(mesaCambioCtaRevisarLabel("ADVISOR_UPDATE"), "Revisar cambios");
    assert.doesNotMatch(mesaCambioCtaRevisarLabel("REQUESTED_CORRECTION"), /P130|REQUESTED/);
  });

  it("subfiltro: solicitadas vs otras sin overlap", () => {
    assert.equal(
      matchesMesaCambiosSubfiltro("REQUESTED_CORRECTION", "solicitadas"),
      true,
    );
    assert.equal(
      matchesMesaCambiosSubfiltro("REQUESTED_CORRECTION", "otras"),
      false,
    );
    assert.equal(matchesMesaCambiosSubfiltro("ADVISOR_UPDATE", "otras"), true);
    assert.equal(matchesMesaCambiosSubfiltro("AMBIGUOUS", "otras"), true);
    assert.equal(matchesMesaCambiosSubfiltro("LEGACY", "otras"), true);
    assert.equal(matchesMesaCambiosSubfiltro("LEGACY", "solicitadas"), false);
    assert.equal(matchesMesaCambiosSubfiltro(null, "otras"), true);
    assert.equal(matchesMesaCambiosSubfiltro(null, "solicitadas"), false);
  });

  it("mapea subfiltro a p_quick_filter sin chips hermanos", () => {
    assert.equal(
      mapMesaCambiosSubfiltroToRpc("correccion_enviada", "todos"),
      "correccion_enviada",
    );
    assert.equal(
      mapMesaCambiosSubfiltroToRpc("correccion_enviada", "solicitadas"),
      "correccion_solicitada",
    );
    assert.equal(
      mapMesaCambiosSubfiltroToRpc("correccion_enviada", "otras"),
      "otras_actualizaciones",
    );
    assert.equal(mapMesaCambiosSubfiltroToRpc("nuevos", "solicitadas"), "nuevos");
  });
});
