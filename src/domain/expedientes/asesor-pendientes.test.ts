import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import {
  countAsesorCorreccionesAbiertas,
  formatCorreccionesPendientesCopy,
  getAdvisorPrimaryPendingAction,
  hasAsesorCorreccionAbierta,
  isAsesorCorregirAcuse,
  isAsesorReagendarBiometricos,
  isAsesorReagendarFirma,
  labelAdvisorPendingAction,
  labelAsesorAcusePendiente,
  listAsesorCorreccionesAbiertas,
} from "./asesor-pendientes";
import type { AsesorTareaExpedienteInput } from "@/lib/asesorTareasPendientes";

function row(
  tipo: ExpedienteArchivoResumen["tipo_documento"],
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `${estatus}-${tipo}`,
    nombre_original: "x.pdf",
    mime_type: "application/pdf",
    size_bytes: 1,
    created_at: new Date().toISOString(),
    uploaded_by_role: "asesor",
    uploaded_by_email: "a@b.c",
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

function tarea(
  partial: Partial<AsesorTareaExpedienteInput> = {},
): AsesorTareaExpedienteInput {
  return {
    expedienteId: "exp-1",
    submittedToMesa: true,
    etapaActual: 3,
    dataModeSupabase: true,
    ...partial,
  };
}

describe("listAsesorCorreccionesAbiertas", () => {
  it("1. datos generales rechazados", () => {
    const items = listAsesorCorreccionesAbiertas({
      clienteDatosEstado: "rechazado",
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "datos_generales");
  });

  it("2. documento cliente_* rechazado", () => {
    const items = listAsesorCorreccionesAbiertas({
      archivos: [row("cliente_ine_frente", "rechazado")],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "documento");
  });

  it("3. Acuse rechazado + retención", () => {
    const items = listAsesorCorreccionesAbiertas({
      archivos: [row("retencion_acuse_con_sello", "rechazado")],
      retencionEnvioEstado: "correccion_requerida",
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind, "acuse");
  });

  it("4+21+22. 3 correcciones abiertas → detalle 3; expediente has=1", () => {
    const params = {
      clienteDatosEstado: "rechazado" as const,
      archivos: [
        row("cliente_ine_frente", "rechazado"),
        row("cliente_estado_cuenta", "rechazado"),
      ],
    };
    assert.equal(countAsesorCorreccionesAbiertas(params), 3);
    assert.equal(hasAsesorCorreccionAbierta(params), true);
    // Contador de filtro = 1 expediente (no 3 filas)
    assert.equal(
      [params].filter((p) => hasAsesorCorreccionAbierta(p)).length,
      1,
    );
  });

  it("5. resuelve una de dos → sigue abierta", () => {
    assert.equal(
      hasAsesorCorreccionAbierta({
        clienteDatosEstado: "completo",
        archivos: [row("cliente_ine_frente", "rechazado")],
      }),
      true,
    );
  });

  it("6+7. resuelve todas / cerrada → no aparece", () => {
    assert.equal(
      hasAsesorCorreccionAbierta({
        clienteDatosEstado: "completo",
        archivos: [
          row("cliente_ine_frente", "validado"),
          row("cliente_ine_frente", "resubido"),
        ],
      }),
      false,
    );
    assert.equal(
      hasAsesorCorreccionAbierta({
        clienteDatosEstado: "completo",
        archivos: [row("cliente_ine_frente", "subido")],
      }),
      false,
    );
  });

  it("copy Mesa solicita N elementos", () => {
    assert.match(formatCorreccionesPendientesCopy(1), /1 elemento/);
    assert.match(formatCorreccionesPendientesCopy(2), /2 elementos/);
  });
});

describe("getAdvisorPrimaryPendingAction prioridad", () => {
  it("corrección domina sobre agendar", () => {
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 2,
        tarea: tarea({ etapaActual: 3 }),
      }),
      "necesita_correccion",
    );
    assert.equal(labelAdvisorPendingAction("necesita_correccion"), "Necesita corrección");
  });

  it("9+10. Subir Acuse vs resuelto", () => {
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 8,
          archivos: [],
          dataModeSupabase: true,
        }),
      }),
      "subir_acuse",
    );
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 8,
          archivos: [row("retencion_acuse_con_sello", "subido")],
          dataModeSupabase: true,
        }),
      }),
      null,
    );
  });

  it("11. Corregir Acuse cuando rechazo", () => {
    const input = tarea({
      etapaActual: 8,
      archivos: [row("retencion_acuse_con_sello", "rechazado")],
      retencion: {
        opcion: "con_sello",
        envio: {
          expedienteId: "exp-1",
          enviado: true,
          estado: "correccion_requerida",
          fechaEnvioMesa: "2026-08-01T00:00:00.000Z",
          opcion: "con_sello",
        },
      },
      dataModeSupabase: true,
    });
    assert.equal(isAsesorCorregirAcuse(input), true);
    assert.equal(labelAsesorAcusePendiente(input), "Corregir Acuse");
    assert.equal(
      getAdvisorPrimaryPendingAction({ correccionesAbiertas: 0, tarea: input }),
      "corregir_acuse",
    );
  });

  it("13+14+15. bio agendar / booked / reagendar", () => {
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 3,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
        }),
      }),
      "agendar_biometricos",
    );
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 3,
          agendaBiometricos: { hasActiveBooking: true, hasLastCancelledBooking: false },
        }),
      }),
      null,
    );
    const reagendar = tarea({
      etapaActual: 4,
      agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: true },
    });
    assert.equal(isAsesorReagendarBiometricos(reagendar), true);
    assert.equal(
      getAdvisorPrimaryPendingAction({ correccionesAbiertas: 0, tarea: reagendar }),
      "reagendar_biometricos",
    );
  });

  it("16. bio ya avanzó sin cancel → no pendiente", () => {
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 6,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: true },
        }),
      }),
      null,
    );
  });

  it("17+18+19. firma agendar / booked / reagendar (Acuse ya válido)", () => {
    const acuseOk = [row("retencion_acuse_con_sello", "validado")];
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 9,
          archivos: acuseOk,
          agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: false },
          dataModeSupabase: true,
        }),
      }),
      "agendar_firma",
    );
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 9,
          archivos: acuseOk,
          agendaFirmas: { hasActiveBooking: true, hasLastCancelledBooking: false },
          dataModeSupabase: true,
        }),
      }),
      null,
    );
    const reagendar = tarea({
      etapaActual: 10,
      archivos: acuseOk,
      agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: true },
      dataModeSupabase: true,
    });
    assert.equal(isAsesorReagendarFirma(reagendar), true);
    assert.equal(
      getAdvisorPrimaryPendingAction({ correccionesAbiertas: 0, tarea: reagendar }),
      "reagendar_firma",
    );
  });

  it("20. ya firmó (etapa 11 + Acuse válido) → no pendiente agenda", () => {
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 11,
          archivos: [row("retencion_acuse_con_sello", "validado")],
          agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: true },
          dataModeSupabase: true,
        }),
      }),
      null,
    );
  });

  it("Acuse rechazado cuenta como corrección → una sola acción principal", () => {
    const archivos = [row("retencion_acuse_con_sello", "rechazado")];
    const n = countAsesorCorreccionesAbiertas({
      archivos,
      retencionEnvioEstado: "correccion_requerida",
    });
    assert.ok(n >= 1);
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: n,
        tarea: tarea({
          etapaActual: 8,
          archivos,
          retencion: {
            opcion: "con_sello",
            envio: {
              expedienteId: "exp-1",
              enviado: true,
              estado: "correccion_requerida",
              fechaEnvioMesa: "2026-08-01T00:00:00.000Z",
              opcion: "con_sello",
            },
          },
          dataModeSupabase: true,
        }),
      }),
      "necesita_correccion",
    );
  });

  it("prioridad: sin Acuse en etapa 9 → Subir Acuse domina Agendar firma", () => {
    assert.equal(
      getAdvisorPrimaryPendingAction({
        correccionesAbiertas: 0,
        tarea: tarea({
          etapaActual: 9,
          archivos: [],
          agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: false },
          dataModeSupabase: true,
        }),
      }),
      "subir_acuse",
    );
  });
});
