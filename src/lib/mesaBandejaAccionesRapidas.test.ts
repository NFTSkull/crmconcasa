import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MESA_SIGUIENTE_ETAPA_MAP,
  MESA_TIENE_RPC_CANONICA_11_A_12,
  buildMesaExpedienteFocusHref,
  canMesaAgendaRapidaRole,
  canMesaToggleMarcadorRole,
  canMesaTomarExpedienteRole,
  formatMesaFirmaAgendableDesdeLabel,
  hasAcusePrincipalCargado,
  mapBloqueosToSiguienteEtapaReason,
  resolveMesaQuickAction,
  resolveMesaSiguienteEtapaAccion,
  resolveMesaTomarExpedienteAccion,
} from "./mesaBandejaAccionesRapidas";

const mesaRole = "mesa_interno";
const expId = "00000000-0000-4000-9119-000000000099";

describe("mesaBandejaAccionesRapidas P119.3/P119.4/P133", () => {
  it("mapa avanzar sin 3, 8, 9; con 11→12; P132-acuse 5→8", () => {
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[1], 2);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[3], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[4], 5);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[5], 8);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[6], 7);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[8], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[9], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[10], 11);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[11], 12);
    assert.equal(MESA_TIENE_RPC_CANONICA_11_A_12, true);
  });

  it("interna 3: info Mesa; sin avance ni booking", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 3,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
      hasActiveNotificacionBooking: true,
    });
    assert.equal(a.visible, true);
    assert.equal(a.enabled, false);
    assert.equal(a.kind, "info");
    assert.equal(a.label, "Esperando agenda de biométricos del asesor");
    assert.equal(a.usesAvanzarRpc, false);
    assert.equal(a.href, null);
  });

  it("interna 3 sin rol Mesa: sigue informativa (no oculta por rol)", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 3,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: "asesor",
      expedienteId: expId,
    });
    assert.equal(a.visible, true);
    assert.equal(a.kind, "info");
    assert.equal(a.enabled, false);
  });

  it("interna 9: info sin Agendar firma ni avance 9→10", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 9,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
      hasActiveFirmasBooking: false,
      firmaAgendableDesde: "2026-01-01",
      nowMs: Date.parse("2026-07-22T18:00:00.000Z"),
    });
    assert.equal(a.visible, true);
    assert.equal(a.kind, "info");
    assert.equal(a.label, "Esperando agenda del asesor");
    assert.equal(a.enabled, false);
    assert.equal(a.usesAvanzarRpc, false);
    assert.equal(a.href, null);
  });

  it("interna 9 antes de fecha mínima: muestra Firma disponible desde", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 9,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
      firmaAgendableDesde: "2026-08-01",
      nowMs: Date.parse("2026-07-22T18:00:00.000Z"),
    });
    assert.equal(a.kind, "info");
    assert.equal(a.label, "Firma disponible desde 01/08/2026");
    assert.equal(formatMesaFirmaAgendableDesdeLabel("2026-08-01"), "01/08/2026");
  });

  it("interna 8: Esperando carga de Acuse; sin avance rápido", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 8,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
      archivosResumen: [],
    });
    assert.equal(a.visible, true);
    assert.equal(a.enabled, false);
    assert.equal(a.kind, "info");
    assert.equal(a.label, "Esperando carga de Acuse por el asesor");
    assert.equal(a.usesAvanzarRpc, false);
  });

  it("interna 8 con Acuse cargado: sigue informativa (avance solo vía upload)", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 8,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
      archivosResumen: [
        {
          tipo_documento: "retencion_acuse_con_sello",
          id: "doc-1",
          estatus_revision: "subido",
        } as never,
      ],
    });
    assert.equal(a.kind, "info");
    assert.equal(a.enabled, false);
    assert.equal(a.usesAvanzarRpc, false);
  });

  it("interna 5: Pasar a Acuse → 5→8", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 5,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      fechaCita: "2026-07-01T15:00:00Z",
      hasActiveBiometricBooking: true,
      nowMs: Date.parse("2026-07-22T18:00:00.000Z"),
      role: mesaRole,
      expedienteId: expId,
    });
    assert.equal(a.visible, true);
    assert.equal(a.kind, "avanzar");
    assert.equal(a.label, "Pasar a Acuse");
    assert.equal(a.usesAvanzarRpc, true);
    assert.equal(a.toEtapa, 8);
    assert.equal(a.fromEtapa, 5);

    const q = resolveMesaQuickAction({
      etapaActual: 5,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      fechaCita: "2026-07-01T15:00:00Z",
      hasActiveBiometricBooking: true,
      nowMs: Date.parse("2026-07-22T18:00:00.000Z"),
    });
    assert.equal(q.label, "Pasar a Acuse");
    assert.equal(q.targetStage, 8);
    assert.equal(q.enabled, true);
    assert.equal(q.requiresConfirmation, true);
  });

  it("interna 10: Marcar firma como completada → 10→11", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 10,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      fechaCita: "2026-08-01T15:00:00Z",
      hasActiveFirmasBooking: true,
      role: mesaRole,
      expedienteId: expId,
    });
    assert.equal(a.visible, true);
    assert.equal(a.kind, "avanzar");
    assert.equal(a.label, "Marcar firma como completada");
    assert.equal(a.usesAvanzarRpc, true);
    assert.equal(a.toEtapa, 11);
  });

  it("interna 4: Pasar a Biometría resultado", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 4,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      fechaCita: "2026-08-01T15:00:00Z",
      hasActiveBiometricBooking: true,
    });
    assert.equal(a.label, "Pasar a Biometría resultado");
    assert.equal(a.usesAvanzarRpc, true);
    assert.equal(a.toEtapa, 5);
  });

  it("interna 6/7 históricas: conservan avance canónico", () => {
    const a6 = resolveMesaSiguienteEtapaAccion({
      etapaActual: 6,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
    });
    assert.equal(a6.toEtapa, 7);
    assert.equal(a6.usesAvanzarRpc, true);

    const a7 = resolveMesaSiguienteEtapaAccion({
      etapaActual: 7,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
    });
    assert.equal(a7.toEtapa, 8);
    assert.equal(a7.usesAvanzarRpc, true);
  });

  it("interna 11: info para decidir Sí/No pagó en detalle (P166)", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 11,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
    });
    assert.equal(a.visible, true);
    assert.equal(a.enabled, false);
    assert.equal(a.kind, "info");
    assert.match(a.label, /Sí pagó \/ No pagó/);
    assert.equal(a.usesAvanzarRpc, false);
    assert.equal(a.toEtapa, 12);
    assert.equal(MESA_TIENE_RPC_CANONICA_11_A_12, true);
  });

  it("interna 11 rechazado: oculto (no en Firmado operable)", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 11,
      subestado: "rechazado",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
    });
    assert.equal(a.visible, false);
  });

  it("interna 12: badge Pago ConCasa con resultado", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 12,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      pagoConcasaResultado: "pagado",
    });
    assert.equal(a.visible, true);
    assert.equal(a.kind, "etapa_final");
    assert.equal(a.label, "Pago ConCasa · Pagó");
    assert.equal(a.enabled, false);
    assert.equal(a.usesAvanzarRpc, false);
  });

  it("helpers acuse / href / roles", () => {
    assert.equal(hasAcusePrincipalCargado([]), false);
    assert.equal(
      hasAcusePrincipalCargado([
        {
          tipo_documento: "retencion_carta_sin_sello",
          id: "x",
          estatus_revision: "validado",
        } as never,
      ]),
      true,
    );
    assert.match(
      buildMesaExpedienteFocusHref(expId, "biometricos"),
      new RegExp(`/mesa-control/${expId}\\?focus=mesa-agenda`),
    );
    assert.equal(canMesaAgendaRapidaRole("mesa_admin"), true);
    assert.equal(canMesaAgendaRapidaRole("asesor"), false);
  });

  it("siguiente etapa 2→3 habilitada en proceso", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 2,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
    });
    assert.equal(a.visible, true);
    assert.equal(a.enabled, true);
    assert.equal(a.toEtapa, 3);
    assert.equal(a.kind, "avanzar");
  });

  it("rechazado: visible deshabilitado", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 2,
      subestado: "rechazado",
      cicloEstado: "activo",
      submittedToMesa: true,
    });
    assert.equal(a.visible, true);
    assert.equal(a.enabled, false);
    assert.equal(a.reasonShort, "Expediente rechazado");
  });

  it("etapa 4 sin cita: deshabilitado con motivo cita", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 4,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      fechaCita: null,
      hasActiveBiometricBooking: false,
    });
    assert.equal(a.visible, true);
    assert.equal(a.enabled, false);
    assert.equal(a.reasonCode, "falta_cita");
  });

  it("map bloqueos → motivos cortos", () => {
    assert.equal(
      mapBloqueosToSiguienteEtapaReason(["Documento obligatorio faltante: INE."]),
      "faltan_documentos",
    );
    assert.equal(
      mapBloqueosToSiguienteEtapaReason(["No hay reserva biométrica activa."]),
      "falta_cita",
    );
  });

  it("roles tomar / marcador intactos", () => {
    assert.equal(canMesaTomarExpedienteRole("mesa_interno"), true);
    assert.equal(canMesaTomarExpedienteRole("asesor"), false);
    assert.equal(canMesaToggleMarcadorRole("mesa_externo"), true);
    assert.equal(canMesaToggleMarcadorRole("asesor"), false);
  });

  it("tomar: visible si sin asignar; no tomar ajeno", () => {
    assert.equal(
      resolveMesaTomarExpedienteAccion({
        ops: null,
        currentUserId: "u1",
        role: "mesa_interno",
        submittedToMesa: true,
        cicloEstado: "activo",
      }).visible,
      true,
    );
    const other = resolveMesaTomarExpedienteAccion({
      ops: {
        expedienteId: "e1",
        estadoMesa: "trabajando",
        assignedTo: "u2",
        assignedAt: "2026-01-01",
        lastActivityAt: null,
        assignedToName: "Otro",
      },
      currentUserId: "u1",
      role: "mesa_interno",
      submittedToMesa: true,
      cicloEstado: "activo",
      assignedDisplayName: "Otro",
    });
    assert.equal(other.visible, false);
    assert.equal(other.assignedToOther, true);
  });

  it("mapa canónico 5→8 (no +1) y sin entradas 3/8/9", () => {
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[5], 8);
    assert.notEqual(MESA_SIGUIENTE_ETAPA_MAP[5], 6);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[3], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[8], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[9], undefined);
  });
});
