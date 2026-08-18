import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos";
import {
  buildAsesorTareaExpedienteInput,
  countAsesorTareasPendientes,
  isAsesorExpedienteAccionable,
  isAsesorPendienteAgendarBiometricos,
  isAsesorPendienteAgendarFirma,
  isAsesorPendienteSubirAcuse,
} from "./asesorTareasPendientes";

function baseInput(
  overrides: Partial<Parameters<typeof buildAsesorTareaExpedienteInput>[0]> = {},
) {
  return buildAsesorTareaExpedienteInput({
    expedienteId: "exp-1",
    submittedToMesa: true,
    etapaActual: 4,
    fechaCita: null,
    dataModeSupabase: true,
    ...overrides,
  });
}

describe("isAsesorPendienteAgendarBiometricos", () => {
  it("etapa 3 enviado a Mesa sin booking activo", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 3,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
        }),
      ),
      true,
    );
  });

  it("etapa 3 con booking activo no cuenta", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 3,
          fechaCita: "2026-07-10T16:00:00.000Z",
          agendaBiometricos: { hasActiveBooking: true, hasLastCancelledBooking: false },
        }),
      ),
      false,
    );
  });

  it("etapa 3 con Notificación activa no cuenta", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 3,
          hasActiveNotificacionBooking: true,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
        }),
      ),
      false,
    );
  });

  it("etapa 4 no cuenta aunque no tenga booking activo", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 4,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
        }),
      ),
      false,
    );
  });

  it("etapa 4/5 tras cancelación biométrica cuenta (reagendar)", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 4,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: true },
        }),
      ),
      true,
    );
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 5,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: true },
        }),
      ),
      true,
    );
  });

  it("booking vigente: cancelled viejo + booked nuevo → no pendiente", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 4,
          agendaBiometricos: { hasActiveBooking: true, hasLastCancelledBooking: true },
        }),
      ),
      false,
    );
  });

  it("booking vigente: varios cancelled + booked activo → no pendiente", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 5,
          agendaBiometricos: { hasActiveBooking: true, hasLastCancelledBooking: true },
        }),
      ),
      false,
    );
  });

  it("etapa superada con cancel histórico → no pendiente", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 6,
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: true },
        }),
      ),
      false,
    );
  });

  it("sin envío a Mesa no cuenta", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(baseInput({ submittedToMesa: false })),
      false,
    );
  });
});

describe("isAsesorExpedienteAccionable / terminales P191", () => {
  it("cancelado etapa 3 no es agendar biométricos (bug real)", () => {
    const input = baseInput({
      etapaActual: 3,
      cicloEstado: "cancelado",
      subestado: "cancelado",
      resultadoReal: "cancelado",
      agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
    });
    assert.equal(isAsesorExpedienteAccionable(input), false);
    assert.equal(isAsesorPendienteAgendarBiometricos(input), false);
  });

  it("etapa 3 normal en_tramite sí cuenta", () => {
    const input = baseInput({
      etapaActual: 3,
      cicloEstado: "activo",
      subestado: "en_proceso",
      resultadoReal: "en_tramite",
      agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
    });
    assert.equal(isAsesorExpedienteAccionable(input), true);
    assert.equal(isAsesorPendienteAgendarBiometricos(input), true);
  });

  it("rechazado_mesa etapa 3 no es tarea; el chip de rechazo es ortogonal", () => {
    const input = baseInput({
      etapaActual: 3,
      cicloEstado: "activo",
      subestado: "rechazado",
      resultadoReal: "rechazado_mesa",
      agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
    });
    assert.equal(isAsesorExpedienteAccionable(input), false);
    assert.equal(isAsesorPendienteAgendarBiometricos(input), false);
    assert.equal(input.resultadoReal, "rechazado_mesa");
  });

  it("reagendar bio válido en_tramite etapa 4/5 sigue TRUE", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 4,
          cicloEstado: "activo",
          subestado: "en_proceso",
          resultadoReal: "en_tramite",
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: true },
        }),
      ),
      true,
    );
  });

  it("cancelado etapa 4/5 con booking cancelled no es reagendar", () => {
    assert.equal(
      isAsesorPendienteAgendarBiometricos(
        baseInput({
          etapaActual: 4,
          cicloEstado: "cancelado",
          resultadoReal: "cancelado",
          agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: true },
        }),
      ),
      false,
    );
  });

  it("firma etapa 9 en_tramite TRUE; terminal FALSE", () => {
    const normal = baseInput({
      etapaActual: 9,
      resultadoReal: "en_tramite",
      cicloEstado: "activo",
      subestado: "en_proceso",
      agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: false },
    });
    const cancelado = baseInput({
      etapaActual: 9,
      resultadoReal: "cancelado",
      cicloEstado: "cancelado",
      agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: false },
    });
    const rechazado = baseInput({
      etapaActual: 9,
      resultadoReal: "rechazado_mesa",
      cicloEstado: "activo",
      subestado: "rechazado",
      agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: false },
    });
    assert.equal(isAsesorPendienteAgendarFirma(normal), true);
    assert.equal(isAsesorPendienteAgendarFirma(cancelado), false);
    assert.equal(isAsesorPendienteAgendarFirma(rechazado), false);
  });

  it("acuse etapa 8 en_tramite TRUE; terminal FALSE", () => {
    const normal = baseInput({
      etapaActual: 8,
      resultadoReal: "en_tramite",
      cicloEstado: "activo",
      archivos: [],
      retencion: { opcion: null, envio: null },
    });
    const cancelado = baseInput({
      etapaActual: 8,
      resultadoReal: "cancelado",
      cicloEstado: "cancelado",
      archivos: [],
      retencion: { opcion: null, envio: null },
    });
    const rechazado = baseInput({
      etapaActual: 8,
      resultadoReal: "rechazado_mesa",
      subestado: "rechazado",
      cicloEstado: "activo",
      archivos: [],
      retencion: { opcion: null, envio: null },
    });
    assert.equal(isAsesorPendienteSubirAcuse(normal), true);
    assert.equal(isAsesorPendienteSubirAcuse(cancelado), false);
    assert.equal(isAsesorPendienteSubirAcuse(rechazado), false);
  });

  it("1 cancelado + 3 accionables: contador 3 (lista=summary)", () => {
    const items = [
      baseInput({
        expedienteId: "c1",
        etapaActual: 3,
        resultadoReal: "cancelado",
        cicloEstado: "cancelado",
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
      baseInput({
        expedienteId: "a1",
        etapaActual: 3,
        resultadoReal: "en_tramite",
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
      baseInput({
        expedienteId: "a2",
        etapaActual: 3,
        resultadoReal: "en_tramite",
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
      baseInput({
        expedienteId: "a3",
        etapaActual: 3,
        resultadoReal: "en_tramite",
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
    ];
    const counts = countAsesorTareasPendientes(items);
    assert.equal(counts.agendarBiometricos, 3);
    const filas = items.filter(isAsesorPendienteAgendarBiometricos);
    assert.equal(filas.length, 3);
    assert.equal(
      filas.every((row) => row.resultadoReal === "en_tramite"),
      true,
    );
  });
});

describe("isAsesorPendienteAgendarFirma", () => {
  it("etapa 9 enviado a Mesa sin booking activo", () => {
    assert.equal(
      isAsesorPendienteAgendarFirma(
        baseInput({
          etapaActual: 9,
          agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: false },
        }),
      ),
      true,
    );
  });

  it("etapa 9 con booking activo no cuenta", () => {
    assert.equal(
      isAsesorPendienteAgendarFirma(
        baseInput({
          etapaActual: 9,
          fechaCita: "2026-07-12T10:00:00.000Z",
          agendaFirmas: { hasActiveBooking: true, hasLastCancelledBooking: false },
        }),
      ),
      false,
    );
  });

  it("etapa 10 solo tras cancelación Mesa sin booking activo", () => {
    assert.equal(
      isAsesorPendienteAgendarFirma(
        baseInput({
          etapaActual: 10,
          agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: true },
        }),
      ),
      true,
    );
  });
});

function archivoRow(
  tipo: ExpedienteArchivoResumen["tipo_documento"],
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `${estatus}-${tipo}`,
    nombre_original: "doc.pdf",
    mime_type: "application/pdf",
    size_bytes: 1,
    created_at: new Date().toISOString(),
    uploaded_by_role: "asesor",
    uploaded_by_email: "asesor@test.c",
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

describe("isAsesorPendienteSubirAcuse", () => {
  const archivosCompletos: ExpedienteArchivoResumen[] = [
    archivoRow("retencion_acuse_con_sello", "subido"),
  ];

  it("etapa 8 sin opción/docs cuenta", () => {
    assert.equal(
      isAsesorPendienteSubirAcuse(
        baseInput({
          etapaActual: 8,
          archivos: [],
          retencion: { opcion: null, envio: null },
        }),
      ),
      true,
    );
  });

  it("etapa 8 con Acuse válido no cuenta", () => {
    assert.equal(
      isAsesorPendienteSubirAcuse(
        baseInput({
          etapaActual: 8,
          archivos: archivosCompletos,
          retencion: { opcion: "con_sello", envio: null },
        }),
      ),
      false,
    );
  });

  it("etapa 8 con documento rechazado por Mesa", () => {
    assert.equal(
      isAsesorPendienteSubirAcuse(
        baseInput({
          etapaActual: 8,
          archivos: [
            archivoRow("retencion_acuse_con_sello", "rechazado"),
          ],
          retencion: {
            opcion: "con_sello",
            envio: {
              expedienteId: "exp-1",
              enviado: true,
              fechaEnvioMesa: "2026-07-01T12:00:00.000Z",
              opcion: "con_sello",
              estado: "correccion_requerida",
            },
          },
        }),
      ),
      true,
    );
  });

  it("etapa 7 no cuenta", () => {
    assert.equal(
      isAsesorPendienteSubirAcuse(
        baseInput({
          etapaActual: 7,
          archivos: [],
          retencion: { opcion: null, envio: null },
        }),
      ),
      false,
    );
  });

  it("P132: etapas 9/10/11/12 sin Acuse cuentan; con Acuse no", () => {
    for (const etapa of [9, 10, 11, 12] as const) {
      assert.equal(
        isAsesorPendienteSubirAcuse(
          baseInput({
            etapaActual: etapa,
            archivos: [],
            retencion: { opcion: null, envio: null },
          }),
        ),
        true,
        `sin acuse etapa ${etapa}`,
      );
      assert.equal(
        isAsesorPendienteSubirAcuse(
          baseInput({
            etapaActual: etapa,
            archivos: archivosCompletos,
            retencion: { opcion: "con_sello", envio: null },
          }),
        ),
        false,
        `con acuse etapa ${etapa}`,
      );
    }
  });
});

describe("countAsesorTareasPendientes y filtros globales", () => {
  it("cuenta tareas sobre todos los expedientes", () => {
    const items = [
      baseInput({
        expedienteId: "bio-1",
        etapaActual: 3,
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
      baseInput({
        expedienteId: "notificacion-1",
        etapaActual: 3,
        hasActiveNotificacionBooking: true,
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
      baseInput({
        expedienteId: "firma-1",
        etapaActual: 9,
        agendaFirmas: { hasActiveBooking: false, hasLastCancelledBooking: false },
        archivos: [archivoRow("retencion_acuse_con_sello", "subido")],
        retencion: { opcion: "con_sello", envio: null },
      }),
      baseInput({
        expedienteId: "acuse-1",
        etapaActual: 8,
        archivos: [],
        retencion: { opcion: null, envio: null },
      }),
      baseInput({
        expedienteId: "corr-1",
        etapaActual: 2,
        submittedToMesa: true,
      }),
    ];
    const counts = countAsesorTareasPendientes(items);
    assert.equal(counts.agendarBiometricos, 1);
    assert.equal(counts.agendarFirma, 1);
    assert.equal(counts.subirAcuse, 1);
  });
});

describe("compatibilidad corrección requerida / enviada", () => {
  it("expediente en corrección documental no altera reglas de agenda", () => {
    const bio = baseInput({
      etapaActual: 3,
      agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
    });
    assert.equal(isAsesorPendienteAgendarBiometricos(bio), true);
  });

  it("búsqueda + filtro biométricos: solo coincide nombre y tarea", () => {
    const items = [
      baseInput({
        expedienteId: "bio-juan",
        etapaActual: 3,
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
      baseInput({
        expedienteId: "bio-pedro",
        etapaActual: 3,
        hasActiveNotificacionBooking: true,
        agendaBiometricos: { hasActiveBooking: false, hasLastCancelledBooking: false },
      }),
    ];
    const nombres = new Map([
      ["bio-juan", "Juan Pérez"],
      ["bio-pedro", "Pedro López"],
    ]);
    const term = "juan";
    const filtrados = items.filter((item) => {
      const nombre = (nombres.get(item.expedienteId) ?? "").toLowerCase();
      return nombre.includes(term) && isAsesorPendienteAgendarBiometricos(item);
    });
    assert.equal(filtrados.length, 1);
    assert.equal(filtrados[0]?.expedienteId, "bio-juan");
  });
});
