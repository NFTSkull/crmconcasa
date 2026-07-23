import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MESA_SIGUIENTE_ETAPA_MAP,
  MESA_TIENE_RPC_CANONICA_11_A_12,
  buildMesaExpedienteFocusHref,
  canMesaAgendaRapidaRole,
  canMesaToggleMarcadorRole,
  canMesaTomarExpedienteRole,
  hasAcusePrincipalCargado,
  mapBloqueosToSiguienteEtapaReason,
  resolveMesaSiguienteEtapaAccion,
  resolveMesaTomarExpedienteAccion,
} from "./mesaBandejaAccionesRapidas";

const mesaRole = "mesa_interno";
const expId = "00000000-0000-4000-9119-000000000099";

describe("mesaBandejaAccionesRapidas P119.3", () => {
  it("mapa avanzar sin 3, 8, 9, 11", () => {
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[1], 2);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[3], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[4], 5);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[8], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[9], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[10], 11);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[11], undefined);
    assert.equal(MESA_TIENE_RPC_CANONICA_11_A_12, false);
  });

  it("interna 3: Agendar biométricos; nunca avanzar/usesAvanzarRpc", () => {
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
    assert.equal(a.enabled, true);
    assert.equal(a.kind, "navegar_biometricos");
    assert.equal(a.label, "Agendar biométricos");
    assert.equal(a.usesAvanzarRpc, false);
    assert.match(a.href ?? "", /mesa-agenda/);
    assert.equal(a.toEtapa, 4);
  });

  it("interna 3 sin rol Mesa: oculta", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 3,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: "asesor",
      expedienteId: expId,
    });
    assert.equal(a.visible, false);
  });

  it("interna 9: Agendar firma; nunca avance directo 9→10", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 9,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
      hasActiveFirmasBooking: false,
    });
    assert.equal(a.visible, true);
    assert.equal(a.kind, "navegar_firma");
    assert.equal(a.label, "Agendar firma");
    assert.equal(a.usesAvanzarRpc, false);
    assert.match(a.href ?? "", /mesa-agendar-firma/);
  });

  it("interna 8 sin Acuse: deshabilitado con motivo canónico", () => {
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
    assert.equal(a.kind, "navegar_acuse");
    assert.equal(a.usesAvanzarRpc, false);
    assert.equal(a.reasonShort, "Falta cargar el Acuse");
  });

  it("interna 8 con Acuse: navega; no RPC avanzar", () => {
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
    assert.equal(a.enabled, true);
    assert.equal(a.usesAvanzarRpc, false);
    assert.match(a.href ?? "", /mesa-retencion/);
  });

  it("interna 10: Pasar a Firmado reutiliza avanzar P117", () => {
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
    assert.equal(a.label, "Pasar a Firmado");
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
  });

  it("interna 11: oculta sin RPC canónica 11→12", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 11,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
      role: mesaRole,
      expedienteId: expId,
    });
    assert.equal(a.visible, false);
    assert.equal(MESA_TIENE_RPC_CANONICA_11_A_12, false);
  });

  it("interna 12: Etapa final sin acción", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 12,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
    });
    assert.equal(a.visible, true);
    assert.equal(a.kind, "etapa_final");
    assert.equal(a.label, "Etapa final");
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
});
