import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MESA_SIGUIENTE_ETAPA_MAP,
  canMesaToggleMarcadorRole,
  canMesaTomarExpedienteRole,
  mapBloqueosToSiguienteEtapaReason,
  resolveMesaSiguienteEtapaAccion,
  resolveMesaTomarExpedienteAccion,
} from "./mesaBandejaAccionesRapidas";

describe("mesaBandejaAccionesRapidas P119", () => {
  it("mapa de transiciones canónicas sin saltos", () => {
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[1], 2);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[3], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[4], 5);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[9], undefined);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[10], 11);
    assert.equal(MESA_SIGUIENTE_ETAPA_MAP[11], undefined);
  });

  it("oculta interna 3 y 9 (booking, no avance rápido)", () => {
    assert.equal(
      resolveMesaSiguienteEtapaAccion({
        etapaActual: 3,
        subestado: "en_proceso",
        cicloEstado: "activo",
        submittedToMesa: true,
        hasActiveNotificacionBooking: true,
        fechaCita: "2026-01-01T12:00:00Z",
      }).visible,
      false,
    );
    assert.equal(
      resolveMesaSiguienteEtapaAccion({
        etapaActual: 9,
        subestado: "en_proceso",
        cicloEstado: "activo",
        submittedToMesa: true,
        hasActiveFirmasBooking: true,
        fechaCita: "2026-01-01T12:00:00Z",
      }).visible,
      false,
    );
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
  });

  it("oculta sin transición (etapa 11)", () => {
    const a = resolveMesaSiguienteEtapaAccion({
      etapaActual: 11,
      subestado: "en_proceso",
      cicloEstado: "activo",
      submittedToMesa: true,
    });
    assert.equal(a.visible, false);
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

  it("roles tomar / marcador", () => {
    assert.equal(canMesaTomarExpedienteRole("mesa_interno"), true);
    assert.equal(canMesaTomarExpedienteRole("asesor"), false);
    assert.equal(canMesaToggleMarcadorRole("mesa_externo"), true);
    assert.equal(canMesaToggleMarcadorRole("asesor"), false);
  });

  it("tomar: visible si sin asignar; asignado a mí; no tomar ajeno", () => {
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
    const mine = resolveMesaTomarExpedienteAccion({
      ops: {
        expedienteId: "e1",
        estadoMesa: "trabajando",
        assignedTo: "u1",
        assignedAt: "2026-01-01",
        lastActivityAt: null,
        assignedToName: "Yo",
      },
      currentUserId: "u1",
      role: "mesa_interno",
      submittedToMesa: true,
      cicloEstado: "activo",
    });
    assert.equal(mine.visible, false);
    assert.equal(mine.assignedToMe, true);

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
    assert.equal(other.assignedLabel, "Otro");
  });
});
