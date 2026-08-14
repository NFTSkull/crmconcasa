import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  applyResolvedReprecalToRow,
  buildReprecalResolutionPayload,
  createEditorReprecalSaveGuard,
  mapExpedienteToEditorRow,
} from "../../app/editor/editor-decision";
import type { ExpedienteMock } from "./mock.repo";
import {
  buildEditorReprecalSidecar,
  editorRevisionDisplay,
  isEditorReprecalIntentoReal,
  MSG_EDITOR_REPRECAL_EMPTY,
  pickLatestResolvedRealReprecalIntento,
  type EditorReprecalIntentoRow,
} from "./editor-reprecal-read-model";
import { EDITOR_LIST_PAGE_SIZE } from "./editor-list-query";

function mockExp(patch?: {
  decision?: ExpedienteMock["editorDecision"];
  pendingId?: string | null;
}): ExpedienteMock {
  return {
    id: "exp-1",
    base: {
      programa: "mejoravit",
      nss: "11111111111",
      cliente_nombre: "Cliente P185",
      telefono_cliente: "5511111111",
      direccion_opcional: "",
      asesorId: "asesor-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      origenMesa: null,
    },
    editorDecision: patch?.decision ?? {
      decision: "no_cumple",
      monto_aprobado: null,
      notas_revision: "NO CUMPLE CRITERIOS",
    },
    operativo: {
      etapaActual: 1,
      subestado: "pendiente",
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
      updatedAt: "2026-08-14T12:00:00.000Z",
      submittedToMesa: false,
      fechaEnvioMesa: null,
      cicloEstado: "activo",
    },
    reprecalificacionPendienteId: patch?.pendingId ?? null,
  };
}

function intento(
  patch: Partial<EditorReprecalIntentoRow> &
    Pick<EditorReprecalIntentoRow, "id" | "decision">,
): EditorReprecalIntentoRow {
  return {
    expediente_id: "exp-1",
    monto_aprobado: null,
    notas_revision: null,
    decision_previa: "aprobado",
    idempotency_key: "key-1",
    created_at: "2026-08-01T00:00:00.000Z",
    decided_at: "2026-08-02T00:00:00.000Z",
    programa_solicitado: null,
    ...patch,
  };
}

describe("P185 editor re-precal limpia", () => {
  it("A) vigente no_cumple + pending → Pendiente y campos vacíos", () => {
    const exp = mockExp({
      decision: {
        decision: "no_cumple",
        monto_aprobado: null,
        notas_revision: "NO CUMPLE CRITERIOS",
      },
      pendingId: "intento-nuevo",
    });
    const row = mapExpedienteToEditorRow(exp);
    assert.equal(row.decision, "pendiente");
    assert.equal(row.monto_aprobado, null);
    assert.equal(row.notas_revision, "");
    assert.equal(row.esReprecalPendiente, true);
  });

  it("B) vigente aprobado 100k + pending → Pendiente vacío", () => {
    const exp = mockExp({
      decision: {
        decision: "aprobado",
        monto_aprobado: 100000,
        notas_revision: "ok anterior",
      },
      pendingId: "intento-nuevo",
    });
    const row = mapExpedienteToEditorRow(exp);
    assert.equal(row.decision, "pendiente");
    assert.equal(row.monto_aprobado, null);
    assert.equal(row.notas_revision, "");
  });

  it("C) pending + monto 120k → payload aprobado", () => {
    const payload = buildReprecalResolutionPayload("120000", "nota opcional");
    assert.deepEqual(payload, {
      decision: "aprobado",
      monto_aprobado: 120000,
      notas_revision: "nota opcional",
    });
  });

  it("D) pending + nota nueva → payload no_cumple", () => {
    const payload = buildReprecalResolutionPayload(
      "",
      "NO ALCANZA CRITERIO ACTUAL",
    );
    assert.deepEqual(payload, {
      decision: "no_cumple",
      monto_aprobado: null,
      notas_revision: "NO ALCANZA CRITERIO ACTUAL",
    });
  });

  it("E) pending vacío → no guarda", () => {
    assert.throws(
      () => buildReprecalResolutionPayload("", ""),
      (err: unknown) =>
        err instanceof Error && err.message === MSG_EDITOR_REPRECAL_EMPTY,
    );
  });

  it("F) doble click guardar → máximo 1 begin", () => {
    const guard = createEditorReprecalSaveGuard();
    assert.equal(guard.tryBegin("exp-1"), true);
    assert.equal(guard.tryBegin("exp-1"), false);
    guard.end("exp-1");
    assert.equal(guard.tryBegin("exp-1"), true);
  });

  it("G) approved resolved muestra monto nuevo", () => {
    const row = mapExpedienteToEditorRow(
      mockExp({
        decision: {
          decision: "aprobado",
          monto_aprobado: 100000,
          notas_revision: "vieja",
        },
        pendingId: null,
      }),
      {
        estado: "approved",
        intentoId: "i2",
        solicitadaAt: "2026-08-10T00:00:00.000Z",
        resueltaAt: "2026-08-11T00:00:00.000Z",
        montoResultado: 120000,
        notasResultado: "nuevo ok",
        programaSolicitado: null,
      },
    );
    assert.equal(row.decision, "aprobado");
    assert.equal(row.monto_aprobado, 120000);
    assert.equal(row.notas_revision, "nuevo ok");
    assert.equal(row.reprecalResuelta, true);
    const applied = applyResolvedReprecalToRow(row, {
      decision: "aprobado",
      monto_aprobado: 120000,
      notas_revision: "nuevo ok",
    });
    assert.equal(applied.esReprecalPendiente, false);
  });

  it("H) no_cumple resolved reload usa nota del intento REAL", () => {
    const sidecar = buildEditorReprecalSidecar([
      intento({
        id: "hist",
        decision: "aprobado",
        monto_aprobado: 100000,
        notas_revision: "nota histórica",
        decided_at: "2026-07-01T00:00:00.000Z",
      }),
      intento({
        id: "nuevo",
        decision: "no_cumple",
        notas_revision: "NO ALCANZA CRITERIO ACTUAL",
        decided_at: "2026-08-12T00:00:00.000Z",
      }),
    ]);
    const exp = mockExp({
      decision: {
        decision: "aprobado",
        monto_aprobado: 100000,
        notas_revision: "nota histórica",
      },
      pendingId: null,
    });
    const display = editorRevisionDisplay(exp, sidecar["exp-1"]);
    assert.equal(display.decision, "no_cumple");
    assert.equal(display.monto_aprobado, null);
    assert.equal(display.notas_revision, "NO ALCANZA CRITERIO ACTUAL");
  });

  it("I) snapshot histórico P155 no es re-precal REAL", () => {
    const snap = intento({
      id: "p155",
      decision: "aprobado",
      decision_previa: null,
      idempotency_key: null,
      monto_aprobado: 80000,
    });
    assert.equal(isEditorReprecalIntentoReal(snap), false);
    assert.equal(pickLatestResolvedRealReprecalIntento([snap]), null);
    const sidecar = buildEditorReprecalSidecar([snap]);
    assert.equal(sidecar["exp-1"], undefined);
    const row = mapExpedienteToEditorRow(
      mockExp({
        decision: {
          decision: "aprobado",
          monto_aprobado: 80000,
          notas_revision: "inicial",
        },
        pendingId: null,
      }),
      sidecar["exp-1"],
    );
    assert.equal(row.decision, "aprobado");
    assert.equal(row.monto_aprobado, 80000);
    assert.equal(row.reprecalResuelta, false);
  });

  it("J) fila normal sin re-precal conserva editorDecision", () => {
    const exp = mockExp({
      decision: {
        decision: "pendiente",
        monto_aprobado: null,
        notas_revision: "",
      },
      pendingId: null,
    });
    const row = mapExpedienteToEditorRow(exp);
    assert.equal(row.decision, "pendiente");
    assert.equal(row.esReprecalPendiente, false);
    assert.equal(row.reprecalResuelta, false);
  });

  it("K) búsqueda/paginación editor intactas", () => {
    assert.equal(EDITOR_LIST_PAGE_SIZE, 50);
    const pageSrc = readFileSync(
      resolve("src/app/editor/page.tsx"),
      "utf8",
    );
    assert.match(pageSrc, /SEARCH_DEBOUNCE_MS = 300/);
    assert.match(pageSrc, /SUPABASE_SAVE_DEBOUNCE_MS = 750/);
  });

  it("L) montar pending no muta editorDecision vigente", () => {
    const exp = mockExp({
      decision: {
        decision: "no_cumple",
        monto_aprobado: null,
        notas_revision: "NO CUMPLE CRITERIOS",
      },
      pendingId: "intento-nuevo",
    });
    mapExpedienteToEditorRow(exp);
    assert.equal(exp.editorDecision.decision, "no_cumple");
    assert.equal(exp.editorDecision.notas_revision, "NO CUMPLE CRITERIOS");
  });
});

describe("P185 editor dashboard source", () => {
  it("pending usa Guardar actualización y no autosave", () => {
    const src = readFileSync(resolve("src/app/editor/page.tsx"), "utf8");
    assert.match(src, /Guardar actualización/);
    assert.match(src, /Nueva re-precalificación/);
    assert.match(src, /Precalificación actualizada/);
    assert.match(src, /handleGuardarActualizacion/);
    assert.match(src, /if \(row\.esReprecalPendiente\)/);
    assert.match(src, /reprecalByExpedienteId/);
    assert.match(src, /createEditorReprecalSaveGuard/);
    assert.doesNotMatch(
      src,
      /if \(row\.esReprecalPendiente\)[\s\S]{0,80}scheduleSupabaseSave/,
    );
  });

  it("detalle pending sigue vaciando con helper compartido", () => {
    const src = readFileSync(resolve("src/app/editor/[id]/page.tsx"), "utf8");
    assert.match(src, /editorRevisionDisplay/);
    assert.match(src, /listEditorReprecalMeta/);
  });
});
