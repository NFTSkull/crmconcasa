import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPostgrestFunctionMissing } from "@/domain/expedientes/postgrest-function-missing";
import {
  displayNameForInfonavitPdfDoc,
  infonavitPdfEstadoJsonHasForbiddenKeys,
  infonavitPdfEstadoNeedsPoll,
  infonavitPdfUiStatusLabel,
  INFONAVIT_PDF_ESTADO_POLL_MS,
  parseInfonavitPdfEstado,
  shouldShowInfonavitPdfSection,
  startInfonavitPdfEstadoPolling,
} from "./infonavit-pdf-estado";

const THREE = [
  "infonavit_carta_bajo_protesta",
  "infonavit_presupuesto_mejoramiento",
  "infonavit_solicitud_inscripcion",
] as const;

describe("P189 B5 read model UI", () => {
  it("labels de status", () => {
    assert.equal(infonavitPdfUiStatusLabel("pending"), "Generando");
    assert.equal(infonavitPdfUiStatusLabel("processing"), "Generando");
    assert.equal(infonavitPdfUiStatusLabel("done"), "Listo");
    assert.equal(infonavitPdfUiStatusLabel("failed"), "Error de generación");
  });

  it("non-Mejoravit y legacy no muestran sección ni error", () => {
    assert.equal(shouldShowInfonavitPdfSection({ aplica: false, has_submission: false }), false);
    assert.equal(shouldShowInfonavitPdfSection({ aplica: true, has_submission: false }), false);
    assert.equal(shouldShowInfonavitPdfSection({ aplica: true, has_submission: true }), true);
    const legacy = parseInfonavitPdfEstado({
      aplica: true,
      has_submission: false,
      documents: [],
    });
    assert.equal(legacy.aplica, true);
    assert.equal(legacy.has_submission, false);
    assert.equal(legacy.documents.length, 0);
    assert.equal(infonavitPdfEstadoNeedsPoll(legacy), false);
  });

  it("PGRST202 de get_expediente_infonavit_pdf_estado se trata como sin submission", () => {
    assert.equal(
      isPostgrestFunctionMissing({
        code: "PGRST202",
        message:
          "Could not find the function public.get_expediente_infonavit_pdf_estado in the schema cache",
      }),
      true,
    );
    assert.equal(
      shouldShowInfonavitPdfSection({ aplica: true, has_submission: false }),
      false,
    );
    assert.equal(
      isPostgrestFunctionMissing({
        code: "42501",
        message: "permission denied for function get_expediente_infonavit_pdf_estado",
      }),
      false,
    );
  });

  it("pending necesita poll; done/failed no", () => {
    const pending = parseInfonavitPdfEstado({
      aplica: true,
      has_submission: true,
      submission_version: 0,
      submission_kind: "initial",
      documents: THREE.map((t) => ({
        document_type: t,
        status: "pending",
        latest_document: null,
        previous_document: null,
      })),
    });
    assert.equal(pending.documents.length, 3);
    assert.equal(infonavitPdfEstadoNeedsPoll(pending), true);
    const done = parseInfonavitPdfEstado({
      ...pending,
      documents: THREE.map((t) => ({
        document_type: t,
        status: "done",
        latest_document: {
          id: `doc-${t}`,
          tipo_documento: t,
          nombre_original: displayNameForInfonavitPdfDoc(t, null),
          mime_type: "application/pdf",
          size_bytes: 10,
          version: 1,
          created_at: "2026-08-17T00:00:00.000Z",
        },
        previous_document: null,
      })),
    });
    assert.equal(infonavitPdfEstadoNeedsPoll(done), false);
    const mixed = parseInfonavitPdfEstado({
      aplica: true,
      has_submission: true,
      documents: [
        { document_type: THREE[0], status: "failed" },
        { document_type: THREE[1], status: "done" },
        { document_type: THREE[2], status: "done" },
      ],
    });
    assert.equal(infonavitPdfEstadoNeedsPoll(mixed), false);
  });

  it("reingreso pending conserva previous y no trata S1 como vigente", () => {
    const estado = parseInfonavitPdfEstado({
      aplica: true,
      has_submission: true,
      submission_version: 1,
      submission_kind: "reingreso",
      documents: [
        {
          document_type: THREE[0],
          status: "pending",
          latest_document: null,
          previous_document: {
            id: "s1",
            tipo_documento: THREE[0],
            nombre_original: "Carta Bajo Protesta.pdf",
            mime_type: "application/pdf",
            size_bytes: 1,
            version: 1,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        },
      ],
    });
    const carta = estado.documents.find((d) => d.document_type === THREE[0]);
    assert.equal(carta?.status, "pending");
    assert.equal(carta?.latest_document, null);
    assert.equal(carta?.previous_document?.id, "s1");
    assert.equal(infonavitPdfUiStatusLabel(carta!.status), "Generando");
  });

  it("JSON sin keys de PII / snapshot / secret", () => {
    const json = JSON.stringify({
      aplica: true,
      has_submission: true,
      submission_version: 0,
      documents: [{ document_type: THREE[0], status: "done" }],
    });
    assert.equal(infonavitPdfEstadoJsonHasForbiddenKeys(json), false);
    assert.equal(
      infonavitPdfEstadoJsonHasForbiddenKeys('{"nss":"123","payload":{}}'),
      true,
    );
    assert.equal(
      infonavitPdfEstadoJsonHasForbiddenKeys('{"snapshot_hash":"abc"}'),
      true,
    );
  });

  it("polling ~10s se detiene y hace cleanup", () => {
    assert.equal(INFONAVIT_PDF_ESTADO_POLL_MS, 10_000);
    let ticks = 0;
    let cleared = 0;
    const handlers: Array<() => void> = [];
    const stop = startInfonavitPdfEstadoPolling({
      enabled: true,
      needsPoll: true,
      onTick: () => {
        ticks += 1;
      },
      intervalMs: 10_000,
      setIntervalFn: (handler) => {
        handlers.push(handler);
        return 7;
      },
      clearIntervalFn: () => {
        cleared += 1;
      },
    });
    assert.equal(handlers.length, 1);
    handlers[0]?.();
    handlers[0]?.();
    assert.equal(ticks, 2);
    stop();
    assert.equal(cleared, 1);

    let started = false;
    const stopIdle = startInfonavitPdfEstadoPolling({
      enabled: true,
      needsPoll: false,
      onTick: () => {
        started = true;
      },
      setIntervalFn: () => {
        started = true;
        return 1;
      },
      clearIntervalFn: () => {},
    });
    stopIdle();
    assert.equal(started, false);
  });
});
