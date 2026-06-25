import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "@/domain/expediente-archivos/integration-docs-completos";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import {
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo3a4View,
  deriveAvanceOperativo4a5View,
  deriveAvanceOperativo5a6View,
  deriveAvanceOperativo6a7View,
  deriveBloqueosContinuarIntegracion,
  deriveCierreValidacionDocumentalView,
  etapaTrasAvanceIntegracion1a2,
  puedeContinuarIntegracion,
  puedeMostrarAvanceOperativo2a3,
  puedeMostrarAvanceOperativo3a4,
  puedeMostrarAvanceOperativo4a5,
  puedeMostrarAvanceOperativo5a6,
  puedeMostrarAvanceOperativo6a7,
  puedeMostrarContinuarIntegracion,
  type MesaAvanceOperativo4a5Context,
  type MesaAvanceOperativo5a6Context,
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
    const archivos = resumenTodosValidados().filter((a) => a.tipo_documento !== "nss");
    const bloqueos = deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos }));
    assert.ok(bloqueos.some((b) => /nss/i.test(b)));
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
      a.tipo_documento === "nss" ? row("nss", "resubido") : a,
    );
    const bloqueos = deriveBloqueosContinuarIntegracion(baseCtx({ archivosResumen: archivos }));
    assert.ok(bloqueos.some((b) => /resubido/i.test(b)));
    assert.equal(puedeContinuarIntegracion(baseCtx({ archivosResumen: archivos })), false);
  });

  it("habilitado si datos + 5 docs asesor están validados", () => {
    assert.deepEqual(deriveBloqueosContinuarIntegracion(baseCtx()), []);
    assert.equal(puedeContinuarIntegracion(baseCtx()), true);
  });
});

describe("deriveCierreValidacionDocumentalView", () => {
  it("checklist con 5 docs asesor y 3 complementarios informativos", () => {
    const view = deriveCierreValidacionDocumentalView(baseCtx());
    assert.equal(view.mostrar, true);
    assert.equal(view.datosGeneralesValidados, true);
    assert.equal(view.documentosAsesor.length, 5);
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
      a.tipo_documento === "nss" ? row("nss", "rechazado") : a,
    );
    const view = deriveCierreValidacionDocumentalView(baseCtx({ archivosResumen: archivos }));
    assert.equal(view.puedeAvanzar, false);
    assert.ok(view.documentosAsesor.find((d) => d.tipo === "nss")?.completo === false);
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
  it("visible en etapa 3 / en_proceso con envío a Mesa y ciclo activo", () => {
    assert.equal(puedeMostrarAvanceOperativo3a4(avance3a4Ctx()), true);
  });

  it("no visible en etapa 2", () => {
    assert.equal(puedeMostrarAvanceOperativo3a4(avance3a4Ctx({ etapaActual: 2 })), false);
  });

  it("no visible en etapa 4", () => {
    assert.equal(puedeMostrarAvanceOperativo3a4(avance3a4Ctx({ etapaActual: 4 })), false);
  });

  it("no visible sin submitted_to_mesa", () => {
    assert.equal(
      puedeMostrarAvanceOperativo3a4(avance3a4Ctx({ submittedToMesa: false })),
      false,
    );
  });

  it("no visible si subestado distinto de en_proceso", () => {
    assert.equal(
      puedeMostrarAvanceOperativo3a4(avance3a4Ctx({ subestado: "en_validacion_mesa" })),
      false,
    );
  });

  it("no visible si ciclo no activo", () => {
    assert.equal(
      puedeMostrarAvanceOperativo3a4(avance3a4Ctx({ cicloEstado: "cerrado" })),
      false,
    );
  });

  it("no visible si ciclo null (espejo SQL estricto)", () => {
    assert.equal(puedeMostrarAvanceOperativo3a4(avance3a4Ctx({ cicloEstado: null })), false);
  });
});

describe("deriveAvanceOperativo3a4View", () => {
  it("habilita avance cuando gates 3→4 se cumplen", () => {
    const view = deriveAvanceOperativo3a4View(avance3a4Ctx());
    assert.equal(view.mostrar, true);
    assert.equal(view.puedeAvanzar, true);
    assert.deepEqual(view.bloqueos, []);
  });

  it("oculto tras avance a etapa 4", () => {
    const view = deriveAvanceOperativo3a4View(avance3a4Ctx({ etapaActual: 4 }));
    assert.equal(view.mostrar, false);
    assert.equal(view.puedeAvanzar, false);
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
