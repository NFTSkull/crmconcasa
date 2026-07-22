import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MESA_CANCELACION_OPERATIVA_CARD_BADGE,
  MESA_CANCELACION_OPERATIVA_CARD_CTA,
  MESA_CANCELACION_OPERATIVA_CARD_INTRO,
  MESA_CANCELACION_OPERATIVA_CARD_TITLE,
} from "./mesa-cancelacion-operativa";
import {
  MESA_RECHAZO_OPERATIVO_CARD_BADGE,
  MESA_RECHAZO_OPERATIVO_CARD_CTA,
  MESA_RECHAZO_OPERATIVO_CARD_INTRO,
  MESA_RECHAZO_OPERATIVO_CARD_TITLE,
  MESA_MOVIMIENTO_NO_ES_RECHAZO_COPY,
} from "./mesa-rechazo-operativo-ux";
import { deriveResultadoRealExpediente } from "./mock.repo";
import type { ExpedienteMock } from "./mock.repo";
import { puedeConsultarReingresoPostBiometricos } from "./reingreso-post-biometricos";

function baseExp(
  patch: Partial<ExpedienteMock["operativo"]>,
): ExpedienteMock {
  return {
    id: "e1",
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: "Cliente",
      telefono_cliente: "5512345678",
      direccion_opcional: "",
      asesorId: "a1",
      createdAt: "2026-01-01T00:00:00.000Z",
      origenMesa: "interno",
    },
    editorDecision: {
      decision: "aprobado",
      monto_aprobado: 10000,
      notas_revision: "",
    },
    operativo: {
      etapaActual: 5,
      subestado: "en_proceso",
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
      fechaEnvioMesa: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      submittedToMesa: true,
      cicloEstado: "activo",
      ...patch,
    },
  } as ExpedienteMock;
}

describe("Mesa rechazo/cancelación UX copy y semántica visual (P099)", () => {
  it("copy: rechazo oscuro puede continuar; cancelación terminal no continuará", () => {
    assert.equal(MESA_RECHAZO_OPERATIVO_CARD_TITLE, "Rechazar expediente");
    assert.match(MESA_RECHAZO_OPERATIVO_CARD_INTRO, /enviará como rechazado al asesor/i);
    assert.match(MESA_RECHAZO_OPERATIVO_CARD_INTRO, /continuar o reingresar/i);
    assert.match(MESA_RECHAZO_OPERATIVO_CARD_BADGE, /puede continuar/i);
    assert.match(MESA_RECHAZO_OPERATIVO_CARD_CTA, /Rechazar expediente/i);
    assert.equal(MESA_CANCELACION_OPERATIVA_CARD_TITLE, "Cancelar trámite");
    assert.equal(
      MESA_CANCELACION_OPERATIVA_CARD_INTRO,
      "El cliente no continuará con el trámite.",
    );
    assert.match(MESA_CANCELACION_OPERATIVA_CARD_BADGE, /no continuará/i);
    assert.match(MESA_CANCELACION_OPERATIVA_CARD_CTA, /Cancelar trámite/i);
  });

  it("tarjeta rechazo oscura; cancelación roja; form solo motivo+nota", () => {
    const rechazo = readFileSync(
      join(
        process.cwd(),
        "src/components/mesa-control/MesaRechazoOperativoPostBiometricosCard.tsx",
      ),
      "utf8",
    );
    const cancel = readFileSync(
      join(
        process.cwd(),
        "src/components/mesa-control/MesaCancelarExpedienteCard.tsx",
      ),
      "utf8",
    );
    assert.match(rechazo, /bg-neutral-950/);
    assert.match(rechazo, /border-neutral-800/);
    assert.match(rechazo, /data-testid="mesa-rechazo-operativo"/);
    assert.match(rechazo, /data-testid="mesa-rechazo-motivo"/);
    assert.match(rechazo, /data-testid="mesa-rechazo-motivo-otro"/);
    assert.match(rechazo, /data-testid="mesa-rechazo-nota"/);
    assert.match(rechazo, /Confirmar rechazo/);
    assert.match(rechazo, /buildRechazoOperativoPayload/);
    assert.doesNotMatch(rechazo, /data-testid="mesa-rechazo-condicion"/);
    assert.doesNotMatch(rechazo, /Condición biométrica|Booking biométrico|Razón biométrica/);
    assert.doesNotMatch(
      rechazo,
      /className="scroll-mt-4 rounded-xl border-2 border-red-400 bg-red-50/,
    );
    assert.match(cancel, /border-red-500/);
    assert.match(cancel, /bg-red-50/);
    assert.doesNotMatch(cancel, /border-emerald-500|bg-emerald-50/);
  });

  it("movimiento manual no registra rechazo", () => {
    assert.match(MESA_MOVIMIENTO_NO_ES_RECHAZO_COPY, /No registra un rechazo/i);
    assert.match(MESA_MOVIMIENTO_NO_ES_RECHAZO_COPY, /filtro «Rechazados»/i);
  });
});

describe("P099 cadena rechazo → bandeja asesor", () => {
  it("RPC canónica → subestado rechazado + ciclo activo → rechazado_mesa (no cancelado)", () => {
    const exp = baseExp({
      subestado: "rechazado",
      cicloEstado: "activo",
      motivoRechazo: "Huellas ilegibles",
      comentarioRechazo: "Nota breve",
      submittedToMesa: true,
    });
    assert.equal(deriveResultadoRealExpediente(exp), "rechazado_mesa");
    assert.notEqual(deriveResultadoRealExpediente(exp), "cancelado");
  });

  it("cancelación terminal solo en Cancelados", () => {
    const exp = baseExp({
      subestado: "en_proceso",
      cicloEstado: "cancelado",
      submittedToMesa: true,
    });
    assert.equal(deriveResultadoRealExpediente(exp), "cancelado");
  });

  it("reingreso sigue consultable cuando subestado rechazado y ciclo activo", () => {
    assert.equal(
      puedeConsultarReingresoPostBiometricos({
        dataModeSupabase: true,
        etapaActual: 5,
        subestado: "rechazado",
        cicloEstado: "activo",
        esHijoReingreso: false,
      }),
      true,
    );
  });

  it("detalle asesor monta banner de rechazo con motivo/nota", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
      "utf8",
    );
    assert.match(page, /AsesorExpedienteRechazadoBanner/);
    assert.match(page, /motivo=\{operativo\?\.motivoRechazo\}/);
    assert.match(page, /comentario=\{operativo\?\.comentarioRechazo\}/);
  });

  it("bandeja asesor muestra chip/motivo de rechazo", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/asesor/page.tsx"),
      "utf8",
    );
    assert.match(page, /asesor-fila-rechazado-mesa/);
    assert.match(page, /p\.operativo\.motivoRechazo/);
    assert.match(page, /rechazados_mesa/);
  });
});
