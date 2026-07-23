import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "@/domain/expediente-archivos/integration-docs-completos";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import {
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo3a4View,
  deriveAvanceOperativo3a5View,
  deriveAvanceOperativo4a5View,
  deriveAvanceOperativo5a6View,
  deriveAvanceOperativo6a7View,
  deriveAvanceOperativo7a8View,
  deriveAvanceOperativo8a9View,
  deriveAvanceOperativo9a10View,
  deriveAvanceOperativo10a11View,
  deriveAvanceOperativo11a12View,
  deriveBloqueosContinuarIntegracion,
  deriveCierreValidacionDocumentalView,
  etapaTrasAvanceIntegracion1a2,
  puedeContinuarIntegracion,
  puedeMostrarAvanceOperativo2a3,
  puedeMostrarAvanceOperativo3a4,
  puedeMostrarAvanceOperativo3a5,
  puedeMostrarAvanceOperativo4a5,
  puedeMostrarAvanceOperativo5a6,
  puedeMostrarAvanceOperativo6a7,
  puedeMostrarAvanceOperativo7a8,
  puedeMostrarAvanceOperativo8a9,
  puedeMostrarAvanceOperativo9a10,
  puedeMostrarAvanceOperativo10a11,
  puedeMostrarAvanceOperativo11a12,
  puedeMostrarContinuarIntegracion,
  type MesaAvanceOperativo4a5Context,
  type MesaAvanceOperativo5a6Context,
  type MesaAvanceOperativo8a9Context,
  type MesaAvanceOperativo9a10Context,
  type MesaAvanceOperativoContext,
  type MesaContinuarIntegracionContext,
} from "./mesa-avance-integracion";

function row(
  tipo: (typeof INTEGRATION_DOC_TIPOS_VALIDACION_MESA)[number],
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `doc-${tipo}`,
    nombre_original: `${tipo}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 100,
    created_at: "2026-06-25T00:00:00.000Z",
    uploaded_by_role: "asesor",
    uploaded_by_email: null,
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

function complementarioRow(
  tipo: "cliente_semanas_cotizadas" | "cliente_acta_nacimiento" | "cliente_constancia_sat",
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `doc-${tipo}`,
    nombre_original: `${tipo}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 100,
    created_at: "2026-06-25T00:00:00.000Z",
    uploaded_by_role: "mesa",
    uploaded_by_email: null,
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

function resumenTodosValidados(): ExpedienteArchivoResumen[] {
  return INTEGRATION_DOC_TIPOS_VALIDACION_MESA.map((tipo) => row(tipo, "validado"));
}

function baseCtx(
  overrides: Partial<MesaContinuarIntegracionContext> = {},
): MesaContinuarIntegracionContext {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 1,
    subestado: "en_validacion_mesa",
    clienteDatosEstado: "validado",
    archivosResumen: resumenTodosValidados(),
    ...overrides,
  };
}

describe("puedeMostrarContinuarIntegracion", () => {
  it("visible en etapa 1 / en_validacion_mesa con envío a Mesa", () => {
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx()), true);
  });

  it("no visible si etapa_actual >= 2", () => {
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx({ etapaActual: 2 })), false);
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx({ etapaActual: 3 })), false);
  });

  it("no visible sin submitted_to_mesa", () => {
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx({ submittedToMesa: false })), false);
  });

  it("no visible si subestado distinto de en_validacion_mesa", () => {
    assert.equal(
      puedeMostrarContinuarIntegracion(baseCtx({ subestado: "en_proceso" })),
      false,
    );
  });
});

describe("deriveBloqueosContinuarIntegracion", () => {
  it("bloqueado si datos no están validados", () => {
    const bloqueos = deriveBloqueosContinuarIntegracion(
      baseCtx({ clienteDatosEstado: "completo" }),
    );
    assert.ok(bloqueos.some((b) => /datos generales/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ clienteDatosEstado: "completo" })), false);
  });

  it("bloqueado si falta documento obligatorio del asesor", () => {
    const archivos = resumenTodosValidados().filter(
      (a) => a.tipo_documento !== "cliente_ine_frente",
    );
    const bloqueos = deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos }));
    assert.ok(bloqueos.some((b) => /INE.*frente/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), false);
  });

  it("bloqueado si un doc asesor está subido sin validar", () => {
    const archivos = resumenTodosValidados().map((a) =>
      a.tipo_documento === "cliente_ine_frente" ? row("cliente_ine_frente", "subido") : a,
    );
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), false);
  });

  it("no bloquea si faltan complementarios Mesa (acta/SAT/semanas)", () => {
    assert.deepEqual(deriveBloqueosContinuarIntegracion(baseCtx()), []);
    assert.equal(puedeContinuarIntegracion(baseCtx()), true);
  });

  it("complementarios subidos o rechazados sin validar no bloquean", () => {
    const archivos = [
      ...resumenTodosValidados(),
      complementarioRow("cliente_acta_nacimiento", "subido"),
      complementarioRow("cliente_constancia_sat", "rechazado"),
      complementarioRow("cliente_semanas_cotizadas", "resubido"),
    ];
    assert.deepEqual(deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos })), []);
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), true);
  });

  it("bloqueado si hay documento resubido sin validar", () => {
    const archivos = resumenTodosValidados().map((a) =>
      a.tipo_documento === "cliente_ine_frente" ? row("cliente_ine_frente", "resubido") : a,
    );
    const bloqueos = deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos }));
    assert.ok(bloqueos.some((b) => /resubido/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), false);
  });

  it("habilitado si datos + 4 docs asesor están validados", () => {
    assert.deepEqual(deriveBloqueosContinuarIntegracion(baseCtx()), []);
    assert.equal(puedeContinuarIntegracion(baseCtx()), true);
  });
});

describe("deriveCierreValidacionDocumentalView", () => {
  it("checklist con 4 docs asesor y 3 complementarios informativos", () => {
    const view = deriveCierreValidacionDocumentalView(baseCtx());
    assert.equal(view.mostrar, true);
    assert.equal(view.datosGeneralesValidados, true);
    assert.equal(view.documentosAsesor.length, 4);
    assert.equal(view.complementarios.length, 3);
    assert.ok(view.complementarios.every((c) => /no bloquea/i.test(c.detalle)));
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("botón deshabilitado si datos no validados", () => {
    const view = deriveCierreValidacionDocumentalView(
      baseCtx({ clienteDatosEstado: "completo" }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /datos generales/i.test(b)));
  });

  it("botón deshabilitado si un doc asesor no está validado", () => {
    const archivos = resumenTodosValidados().map((a) =>
      a.tipo_documento === "cliente_ine_frente" ? row("cliente_ine_frente", "rechazado") : a,
    );
    const view = deriveCierreValidacionDocumentalView(baseCtx({ archivosResumen: archivos }));
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.documentosAsesor.find((d) => d.tipo === "cliente_ine_frente")?.completo === false);
  });

  it("complementarios faltantes no impiden puedeAvanzar", () => {
    const view = deriveCierreValidacionDocumentalView(baseCtx());
    assert.equal(view.puedeAvanzar, true);
    assert.ok(view.complementarios.every((c) => c.presencia === "faltante"));
  });
});

describe("etapaTrasAvanceIntegracion1a2", () => {
  it("panel oculto y timeline en etapa 2 tras avance", () => {
    assert.equal(puedeMostrarContinuarIntegracion(baseCtx({ etapaActual: 2 })), false);
    assert.equal(etapaTrasAvanceIntegracion1a2(2), 2);
    assert.equal(
      deriveCierreValidacionDocumentalView(baseCtx({ etapaActual: 2 })).mostrar,
      false,
    );
  });
});

function avanceCtx(
  overrides: Partial<MesaAvanceOperativoContext> = {},
): MesaAvanceOperativoContext {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 2,
    subestado: "en_proceso",
    ...overrides,
  };
}

describe("puedeMostrarAvanceOperativo2a3", () => {
  it("visible en etapa 2 / en_proceso con envío a Mesa", () => {
    assert.equal(puedeMostrarAvanceOperativo2a3(avanceCtx()), true);
  });

  it("no visible en etapa distinta de 2", () => {
    assert.equal(puedeMostrarAvanceOperativo2a3(avanceCtx({ etapaActual: 1 })), false);
    assert.equal(puedeMostrarAvanceOperativo2a3(avanceCtx({ etapaActual: 3 })), false);
  });

  it("no visible sin submitted_to_mesa", () => {
    assert.equal(puedeMostrarAvanceOperativo2a3(avanceCtx({ submittedToMesa: false })), false);
  });

  it("no visible si subestado distinto de en_proceso", () => {
    assert.equal(
      puedeMostrarAvanceOperativo2a3(avanceCtx({ subestado: "en_validacion_mesa" })),
      false,
    );
  });

  it("no visible si ciclo no activo", () => {
    assert.equal(puedeMostrarAvanceOperativo2a3(avanceCtx({ cicloEstado: "cerrado" })), false);
  });

  it("visible con ciclo null (compat P3L.1; SQL exige activo — deuda técnica)", () => {
    assert.equal(puedeMostrarAvanceOperativo2a3(avanceCtx({ cicloEstado: null })), true);
  });
});

describe("deriveAvanceOperativo2a3View", () => {
  it("habilita avance cuando gates 2→3 se cumplen", () => {
    const view = deriveAvanceOperativo2a3View(avanceCtx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("oculto tras avance a etapa 3", () => {
    const view = deriveAvanceOperativo2a3View(avanceCtx({ etapaActual: 3 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });
});

function avance3a4Ctx(
  overrides: Partial<MesaAvanceOperativoContext> = {},
): MesaAvanceOperativoContext {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 3,
    subestado: "en_proceso",
    ...overrides,
  };
}

describe("puedeMostrarAvanceOperativo3a4", () => {
  it("deprecado: nunca visible en flujo 11 pasos", () => {
    assert.equal(puedeMostrarAvanceOperativo3a4(avance3a4Ctx()), false);
    assert.equal(puedeMostrarAvanceOperativo3a4(avance3a4Ctx({ etapaActual: 3 })), false);
  });
});

describe("deriveAvanceOperativo3a4View", () => {
  it("siempre oculto tras deprecación 3→4", () => {
    const view = deriveAvanceOperativo3a4View(avance3a4Ctx());
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });
});

describe("puedeMostrarAvanceOperativo3a5", () => {
  it("visible en etapa 3 / en_proceso con envío a Mesa y ciclo activo", () => {
    assert.equal(
      puedeMostrarAvanceOperativo3a5({
        ...avance4a5Ctx({ etapaActual: 3 }),
      }),
      true,
    );
  });

  it("no visible en etapa 4 legacy", () => {
    assert.equal(puedeMostrarAvanceOperativo3a5(avance4a5Ctx()), false);
  });

  it("no visible sin submitted_to_mesa", () => {
    assert.equal(
      puedeMostrarAvanceOperativo3a5(avance4a5Ctx({ etapaActual: 3, submittedToMesa: false })),
      false,
    );
  });
});

describe("deriveAvanceOperativo3a5View", () => {
  it("habilita avance 3→5 con cita y notificación activa", () => {
    const view = deriveAvanceOperativo3a5View(
      avance4a5Ctx({
        etapaActual: 3,
        hasActiveNotificacionBooking: true,
        hasActiveBiometricBooking: false,
      }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("bloquea 3→5 sin notificación activa", () => {
    const view = deriveAvanceOperativo3a5View(
      avance4a5Ctx({ etapaActual: 3, hasActiveNotificacionBooking: false }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => b.includes("notificación activa")));
  });

  it("bloquea 3→5 con biométricos activos", () => {
    const view = deriveAvanceOperativo3a5View(
      avance4a5Ctx({
        etapaActual: 3,
        hasActiveNotificacionBooking: true,
        hasActiveBiometricBooking: true,
      }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => b.includes("biométrica activa")));
  });

  it("bloquea 3→5 sin fecha_cita", () => {
    const view = deriveAvanceOperativo3a5View(
      avance4a5Ctx({
        etapaActual: 3,
        hasActiveNotificacionBooking: true,
        fechaCita: null,
      }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => b.includes("Falta fecha de notificación")));
  });
});

function avance4a5Ctx(
  overrides: Partial<MesaAvanceOperativo4a5Context> = {},
): MesaAvanceOperativo4a5Context {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 4,
    subestado: "en_proceso",
    fechaCita: "2026-06-29T16:00:00.000Z",
    hasActiveBiometricBooking: true,
    hasActiveNotificacionBooking: false,
    ...overrides,
  };
}

describe("puedeMostrarAvanceOperativo4a5", () => {
  it("visible en etapa 4 con ciclo activo y enviado a Mesa", () => {
    assert.equal(puedeMostrarAvanceOperativo4a5(avance4a5Ctx()), true);
  });

  it("no visible en etapa 3", () => {
    assert.equal(puedeMostrarAvanceOperativo4a5(avance4a5Ctx({ etapaActual: 3 })), false);
  });

  it("no visible en etapa 5", () => {
    assert.equal(puedeMostrarAvanceOperativo4a5(avance4a5Ctx({ etapaActual: 5 })), false);
  });

  it("no visible sin submitted_to_mesa", () => {
    assert.equal(
      puedeMostrarAvanceOperativo4a5(avance4a5Ctx({ submittedToMesa: false })),
      false,
    );
  });

  it("no visible si ciclo no activo", () => {
    assert.equal(
      puedeMostrarAvanceOperativo4a5(avance4a5Ctx({ cicloEstado: "cerrado" })),
      false,
    );
  });
});

describe("deriveAvanceOperativo4a5View", () => {
  it("habilita avance cuando fecha y booking activo", () => {
    const view = deriveAvanceOperativo4a5View(avance4a5Ctx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("bloquea sin fecha de cita", () => {
    const view = deriveAvanceOperativo4a5View(avance4a5Ctx({ fechaCita: null }));
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.match(view.bloqueos.join(" "), /falta cita biométrica/i);
  });

  it("bloquea sin booking activo", () => {
    const view = deriveAvanceOperativo4a5View(
      avance4a5Ctx({ hasActiveBiometricBooking: false }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.match(view.bloqueos.join(" "), /reserva biométrica activa/i);
  });

  it("oculto en etapa 3", () => {
    const view = deriveAvanceOperativo4a5View(avance4a5Ctx({ etapaActual: 3 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto en etapa 5", () => {
    const view = deriveAvanceOperativo4a5View(avance4a5Ctx({ etapaActual: 5 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto sin envío a Mesa", () => {
    const view = deriveAvanceOperativo4a5View(avance4a5Ctx({ submittedToMesa: false }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto con ciclo no activo", () => {
    const view = deriveAvanceOperativo4a5View(avance4a5Ctx({ cicloEstado: "cerrado" }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });
});

const FIXED_NOW_MS = Date.parse("2026-07-10T12:00:00.000Z");

function avance5a6Ctx(
  overrides: Partial<MesaAvanceOperativo5a6Context> = {},
): MesaAvanceOperativo5a6Context {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 5,
    subestado: "en_proceso",
    fechaCita: "2026-07-08T16:00:00.000Z",
    hasActiveBiometricBooking: true,
    nowMs: FIXED_NOW_MS,
    ...overrides,
  };
}

describe("puedeMostrarAvanceOperativo5a6", () => {
  it("visible en etapa 5 con ciclo activo y en_proceso", () => {
    assert.equal(puedeMostrarAvanceOperativo5a6(avance5a6Ctx()), true);
  });

  it("no visible en etapa 4", () => {
    assert.equal(puedeMostrarAvanceOperativo5a6(avance5a6Ctx({ etapaActual: 4 })), false);
  });

  it("no visible en etapa 6", () => {
    assert.equal(puedeMostrarAvanceOperativo5a6(avance5a6Ctx({ etapaActual: 6 })), false);
  });

  it("no visible con subestado distinto a en_proceso", () => {
    assert.equal(
      puedeMostrarAvanceOperativo5a6(avance5a6Ctx({ subestado: "en_validacion_mesa" })),
      false,
    );
  });
});

describe("deriveAvanceOperativo5a6View", () => {
  it("habilita avance con cita pasada y booking activo", () => {
    const view = deriveAvanceOperativo5a6View(avance5a6Ctx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("bloquea con cita futura", () => {
    const view = deriveAvanceOperativo5a6View(
      avance5a6Ctx({ fechaCita: "2026-07-15T16:00:00.000Z" }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.match(view.bloqueos.join(" "), /aún no ha ocurrido/i);
  });

  it("bloquea sin fecha de cita", () => {
    const view = deriveAvanceOperativo5a6View(avance5a6Ctx({ fechaCita: null }));
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.match(view.bloqueos.join(" "), /falta cita biométrica/i);
  });

  it("bloquea sin booking activo", () => {
    const view = deriveAvanceOperativo5a6View(
      avance5a6Ctx({ hasActiveBiometricBooking: false }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.match(view.bloqueos.join(" "), /reserva biométrica activa/i);
  });

  it("oculto con subestado distinto a en_proceso", () => {
    const view = deriveAvanceOperativo5a6View(
      avance5a6Ctx({ subestado: "en_validacion_mesa" }),
    );
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
    assert.deepEqual(view.bloqueos, []);
  });

  it("oculto en etapa 4", () => {
    const view = deriveAvanceOperativo5a6View(avance5a6Ctx({ etapaActual: 4 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto en etapa 6", () => {
    const view = deriveAvanceOperativo5a6View(avance5a6Ctx({ etapaActual: 6 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto sin envío a Mesa", () => {
    const view = deriveAvanceOperativo5a6View(avance5a6Ctx({ submittedToMesa: false }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto con ciclo no activo", () => {
    const view = deriveAvanceOperativo5a6View(avance5a6Ctx({ cicloEstado: "cerrado" }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });
});

function avance6a7Ctx(
  overrides: Partial<MesaAvanceOperativoContext> = {},
): MesaAvanceOperativoContext {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 6,
    subestado: "en_proceso",
    ...overrides,
  };
}

describe("puedeMostrarAvanceOperativo6a7", () => {
  it("visible en etapa 6 con ciclo activo y en_proceso", () => {
    assert.equal(puedeMostrarAvanceOperativo6a7(avance6a7Ctx()), true);
  });

  it("no visible en etapa 5", () => {
    assert.equal(puedeMostrarAvanceOperativo6a7(avance6a7Ctx({ etapaActual: 5 })), false);
  });

  it("no visible en etapa 7", () => {
    assert.equal(puedeMostrarAvanceOperativo6a7(avance6a7Ctx({ etapaActual: 7 })), false);
  });

  it("no visible con subestado distinto a en_proceso", () => {
    assert.equal(
      puedeMostrarAvanceOperativo6a7(avance6a7Ctx({ subestado: "en_validacion_mesa" })),
      false,
    );
  });
});

describe("deriveAvanceOperativo6a7View", () => {
  it("habilita avance cuando gates 6→7 se cumplen", () => {
    const view = deriveAvanceOperativo6a7View(avance6a7Ctx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("oculto en etapa 5", () => {
    const view = deriveAvanceOperativo6a7View(avance6a7Ctx({ etapaActual: 5 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto en etapa 7", () => {
    const view = deriveAvanceOperativo6a7View(avance6a7Ctx({ etapaActual: 7 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto sin envío a Mesa", () => {
    const view = deriveAvanceOperativo6a7View(avance6a7Ctx({ submittedToMesa: false }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto con ciclo no activo", () => {
    const view = deriveAvanceOperativo6a7View(avance6a7Ctx({ cicloEstado: "cerrado" }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto con subestado distinto a en_proceso", () => {
    const view = deriveAvanceOperativo6a7View(
      avance6a7Ctx({ subestado: "en_validacion_mesa" }),
    );
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });
});

function avance7a8Ctx(
  overrides: Partial<MesaAvanceOperativoContext> = {},
): MesaAvanceOperativoContext {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 7,
    subestado: "en_proceso",
    ...overrides,
  };
}

describe("puedeMostrarAvanceOperativo7a8", () => {
  it("visible en etapa 7 con ciclo activo y en_proceso", () => {
    assert.equal(puedeMostrarAvanceOperativo7a8(avance7a8Ctx()), true);
  });

  it("no visible en etapa 6", () => {
    assert.equal(puedeMostrarAvanceOperativo7a8(avance7a8Ctx({ etapaActual: 6 })), false);
  });

  it("no visible en etapa 8", () => {
    assert.equal(puedeMostrarAvanceOperativo7a8(avance7a8Ctx({ etapaActual: 8 })), false);
  });

  it("no visible con subestado distinto a en_proceso", () => {
    assert.equal(
      puedeMostrarAvanceOperativo7a8(avance7a8Ctx({ subestado: "en_validacion_mesa" })),
      false,
    );
  });
});

describe("deriveAvanceOperativo7a8View", () => {
  it("habilita avance cuando gates 7→8 se cumplen", () => {
    const view = deriveAvanceOperativo7a8View(avance7a8Ctx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("oculto en etapa 6", () => {
    const view = deriveAvanceOperativo7a8View(avance7a8Ctx({ etapaActual: 6 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto en etapa 8", () => {
    const view = deriveAvanceOperativo7a8View(avance7a8Ctx({ etapaActual: 8 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto sin envío a Mesa", () => {
    const view = deriveAvanceOperativo7a8View(avance7a8Ctx({ submittedToMesa: false }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto con ciclo no activo", () => {
    const view = deriveAvanceOperativo7a8View(avance7a8Ctx({ cicloEstado: "cerrado" }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });

  it("oculto con subestado distinto a en_proceso", () => {
    const view = deriveAvanceOperativo7a8View(
      avance7a8Ctx({ subestado: "en_validacion_mesa" }),
    );
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
  });
});

function retencionArchivo(
  tipo:
    | "retencion_acuse_con_sello"
    | "retencion_carta_sin_sello"
    | "retencion_aviso_retencion"
    | "retencion_ine_frente"
    | "retencion_ine_reverso",
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `doc-${tipo}`,
    nombre_original: `${tipo}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 100,
    created_at: "2026-06-25T00:00:00.000Z",
    uploaded_by_role: "asesor",
    uploaded_by_email: "asesor@x.com",
    estatus_revision: estatus,
    comentario_mesa: estatus === "rechazado" ? "nota" : null,
  };
}

function avance8a9Ctx(
  overrides: Partial<MesaAvanceOperativo8a9Context> = {},
): MesaAvanceOperativo8a9Context {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 8,
    subestado: "en_proceso",
    clienteDatosEstado: "validado",
    archivosResumen: [
      retencionArchivo("retencion_acuse_con_sello", "validado"),
    ],
    retencionOpcion: "con_sello",
    retencionEnviadoAMesa: true,
    retencionEnvioEstado: "enviado",
    ...overrides,
  };
}

describe("deriveAvanceOperativo8a9View", () => {
  it("etapa 8 con retención validada puede avanzar", () => {
    const view = deriveAvanceOperativo8a9View(avance8a9Ctx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("P079: principal subido con envío permite avanzar 8→9", () => {
    const view = deriveAvanceOperativo8a9View(
      avance8a9Ctx({
        archivosResumen: [
          retencionArchivo("retencion_acuse_con_sello", "subido"),
        ],
      }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("bloquea con documento rechazado", () => {
    const view = deriveAvanceOperativo8a9View(
      avance8a9Ctx({
        archivosResumen: [
          retencionArchivo("retencion_acuse_con_sello", "rechazado"),
        ],
      }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /rechazado/i.test(b)));
  });

  it("aviso/INE históricos no bloquean avance 8→9", () => {
    const view = deriveAvanceOperativo8a9View(
      avance8a9Ctx({
        archivosResumen: [
          retencionArchivo("retencion_acuse_con_sello", "validado"),
          retencionArchivo("retencion_aviso_retencion", "subido"),
          retencionArchivo("retencion_ine_frente", "rechazado"),
        ],
      }),
    );
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("bloquea sin envío de retención a Mesa", () => {
    const view = deriveAvanceOperativo8a9View(
      avance8a9Ctx({ retencionEnviadoAMesa: false, retencionEnvioEstado: null }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /enviar Acuse/i.test(b)));
  });

  it("bloquea con corrección requerida", () => {
    const view = deriveAvanceOperativo8a9View(
      avance8a9Ctx({ retencionEnvioEstado: "correccion_requerida" }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /corrección requerida/i.test(b)));
  });

  it("no visible en etapa 7", () => {
    const view = deriveAvanceOperativo8a9View(avance8a9Ctx({ etapaActual: 7 }));
    assert.equal(view.mostrar, false);
    assert.equal(puedeMostrarAvanceOperativo8a9(avance8a9Ctx({ etapaActual: 7 })), false);
  });

  it("no visible en etapa 9", () => {
    const view = deriveAvanceOperativo8a9View(avance8a9Ctx({ etapaActual: 9 }));
    assert.equal(view.mostrar, false);
  });

  it("bloquea sin cliente_datos validado", () => {
    const view = deriveAvanceOperativo8a9View(
      avance8a9Ctx({ clienteDatosEstado: "completo" }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /datos generales/i.test(b)));
  });
});

function avance9a10Ctx(
  overrides: Partial<MesaAvanceOperativo9a10Context> = {},
): MesaAvanceOperativo9a10Context {
  return {
    submittedToMesa: true,
    cicloEstado: "activo",
    etapaActual: 9,
    subestado: "en_proceso",
    fechaCita: "2026-06-26T16:00:00.000Z",
    hasActiveFirmasBooking: true,
    ...overrides,
  };
}

describe("deriveAvanceOperativo9a10View (P3P.3)", () => {
  it("etapa 9 con firma booked puede avanzar", () => {
    const view = deriveAvanceOperativo9a10View(avance9a10Ctx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.equal(view.bloqueos.length, 0);
  });

  it("etapa 9 sin fecha_cita bloquea", () => {
    const view = deriveAvanceOperativo9a10View(avance9a10Ctx({ fechaCita: null }));
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /fecha de cita de firma/i.test(b)));
  });

  it("etapa 9 sin booking firmas activo bloquea", () => {
    const view = deriveAvanceOperativo9a10View(
      avance9a10Ctx({ hasActiveFirmasBooking: false }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /reserva de firma activa/i.test(b)));
  });

  it("etapa 9 con booking cancelado (sin activo) bloquea", () => {
    const view = deriveAvanceOperativo9a10View(
      avance9a10Ctx({ hasActiveFirmasBooking: false, fechaCita: "2026-06-26T16:00:00.000Z" }),
    );
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.bloqueos.some((b) => /reserva de firma activa/i.test(b)));
  });

  it("no visible en etapa 8 ni 10", () => {
    assert.equal(deriveAvanceOperativo9a10View(avance9a10Ctx({ etapaActual: 8 })).mostrar, false);
    assert.equal(deriveAvanceOperativo9a10View(avance9a10Ctx({ etapaActual: 10 })).mostrar, false);
    assert.equal(puedeMostrarAvanceOperativo9a10(avance9a10Ctx({ etapaActual: 8 })), false);
    assert.equal(puedeMostrarAvanceOperativo9a10(avance9a10Ctx({ etapaActual: 10 })), false);
  });

  it("no visible sin submitted_to_mesa o ciclo inactivo", () => {
    assert.equal(
      deriveAvanceOperativo9a10View(avance9a10Ctx({ submittedToMesa: false })).mostrar,
      false,
    );
    assert.equal(
      deriveAvanceOperativo9a10View(avance9a10Ctx({ cicloEstado: "cerrado" })).mostrar,
      false,
    );
  });
});

describe("deriveAvanceOperativo10a11View (P117)", () => {
  it("etapa 10 con firma booked puede avanzar a Firmado", () => {
    const view = deriveAvanceOperativo10a11View(avance9a10Ctx({ etapaActual: 10 }));
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.equal(view.bloqueos.length, 0);
  });

  it("etapa 10 sin booking bloquea", () => {
    const view = deriveAvanceOperativo10a11View(
      avance9a10Ctx({ etapaActual: 10, hasActiveFirmasBooking: false }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, false);
  });

  it("no visible en etapa 9 ni 11", () => {
    assert.equal(
      deriveAvanceOperativo10a11View(avance9a10Ctx({ etapaActual: 9 })).mostrar,
      false,
    );
    assert.equal(
      deriveAvanceOperativo10a11View(avance9a10Ctx({ etapaActual: 11 })).mostrar,
      false,
    );
    assert.equal(puedeMostrarAvanceOperativo10a11(avance9a10Ctx({ etapaActual: 9 })), false);
  });

  it("ciclo inactivo no muestra", () => {
    assert.equal(
      deriveAvanceOperativo10a11View(
        avance9a10Ctx({ etapaActual: 10, cicloEstado: "cancelado" }),
      ).mostrar,
      false,
    );
  });
});

describe("deriveAvanceOperativo11a12View (P119.4)", () => {
  it("etapa 11 en_proceso puede avanzar a Pago a ConCasa", () => {
    const view = deriveAvanceOperativo11a12View(
      avanceCtx({ etapaActual: 11, subestado: "en_proceso" }),
    );
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.equal(view.bloqueos.length, 0);
  });

  it("no visible fuera de etapa 11", () => {
    assert.equal(
      deriveAvanceOperativo11a12View(avanceCtx({ etapaActual: 10 })).mostrar,
      false,
    );
    assert.equal(
      deriveAvanceOperativo11a12View(avanceCtx({ etapaActual: 12 })).mostrar,
      false,
    );
    assert.equal(
      puedeMostrarAvanceOperativo11a12(avanceCtx({ etapaActual: 10 })),
      false,
    );
  });

  it("rechazado / ciclo inactivo no muestran", () => {
    assert.equal(
      deriveAvanceOperativo11a12View(
        avanceCtx({ etapaActual: 11, subestado: "rechazado" }),
      ).mostrar,
      false,
    );
    assert.equal(
      deriveAvanceOperativo11a12View(
        avanceCtx({ etapaActual: 11, cicloEstado: "cancelado" }),
      ).mostrar,
      false,
    );
  });
});
