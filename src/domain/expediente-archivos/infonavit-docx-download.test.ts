import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeInfonavitDocxDownload,
  infonavitDocxFilename,
  infonavitDocxPublicMessage,
  infonavitDocxRequestSchema,
  isMesaInfonavitDocxRole,
  parseSubmissionVersion,
} from "./infonavit-docx-download";

const BASE = {
  authenticated: true,
  appRole: "mesa_admin",
  active: true,
  canSeeExpediente: true,
  aplica: true,
  hasSubmission: true,
  estadoSubmissionVersion: 1,
  requestedSubmissionVersion: 1,
  documentType: "infonavit_carta_bajo_protesta",
  documentStatus: "done",
} as const;

describe("infonavit-docx-download policy", () => {
  it("Mesa visible + done + versión exacta → allowed", () => {
    const d = authorizeInfonavitDocxDownload(BASE);
    assert.equal(d.ok, true);
    if (d.ok) {
      assert.equal(d.filename, "Carta Bajo Protesta editable.docx");
      assert.equal(d.b1Type, "carta_bajo_protesta");
      assert.equal(d.submissionVersion, 1);
    }
  });

  it("asesor → denied (mismo mensaje que sin visibilidad)", () => {
    const d = authorizeInfonavitDocxDownload({ ...BASE, appRole: "asesor" });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.httpStatus, 403);
      assert.equal(d.code, "forbidden");
      assert.equal(d.message, infonavitDocxPublicMessage("forbidden"));
      assert.doesNotMatch(d.message, /nss|curp|payload/i);
    }
  });

  it("editor → denied", () => {
    const d = authorizeInfonavitDocxDownload({ ...BASE, appRole: "editor" });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "forbidden");
  });

  it("Mesa sin visibilidad → denied", () => {
    const d = authorizeInfonavitDocxDownload({
      ...BASE,
      canSeeExpediente: false,
    });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.httpStatus, 403);
      assert.equal(d.code, "forbidden");
    }
  });

  it("sin sesión → 401", () => {
    const d = authorizeInfonavitDocxDownload({
      ...BASE,
      authenticated: false,
      appRole: null,
    });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.httpStatus, 401);
  });

  it("snapshot inexistente → 404 controlado", () => {
    const d = authorizeInfonavitDocxDownload({
      ...BASE,
      hasSubmission: false,
      estadoSubmissionVersion: null,
    });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.httpStatus, 404);
      assert.equal(d.code, "snapshot_missing");
    }
  });

  it("documento no done → 409", () => {
    for (const status of ["pending", "processing", "failed", null]) {
      const d = authorizeInfonavitDocxDownload({
        ...BASE,
        documentStatus: status,
      });
      assert.equal(d.ok, false);
      if (!d.ok) {
        assert.equal(d.httpStatus, 409);
        assert.equal(d.code, "not_done");
      }
    }
  });

  it("submission_version incorrecta → no usa otra versión", () => {
    const d = authorizeInfonavitDocxDownload({
      ...BASE,
      estadoSubmissionVersion: 1,
      requestedSubmissionVersion: 0,
    });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.code, "version_mismatch");
      assert.equal(d.httpStatus, 409);
    }
  });

  it("tipo inválido → 400", () => {
    const d = authorizeInfonavitDocxDownload({
      ...BASE,
      documentType: "pagare",
    });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "invalid_request");
  });

  it("filenames sin PII", () => {
    assert.equal(
      infonavitDocxFilename("infonavit_presupuesto_mejoramiento"),
      "Presupuesto de Mejoramiento editable.docx",
    );
    assert.equal(
      infonavitDocxFilename("infonavit_solicitud_inscripcion"),
      "Solicitud de Inscripción editable.docx",
    );
    assert.doesNotMatch(infonavitDocxFilename("infonavit_carta_bajo_protesta"), /\d{11}/);
  });

  it("roles Mesa allowlist", () => {
    assert.equal(isMesaInfonavitDocxRole("mesa_interno"), true);
    assert.equal(isMesaInfonavitDocxRole("mesa_externo"), true);
    assert.equal(isMesaInfonavitDocxRole("super_admin"), true);
    assert.equal(isMesaInfonavitDocxRole("asesor"), false);
    assert.equal(parseSubmissionVersion("1"), 1);
    assert.equal(parseSubmissionVersion(-1), null);
  });

  it("Zod request: uuid + tipo allowlist; mensajes públicos sin PII", () => {
    const ok = infonavitDocxRequestSchema.safeParse({
      expedienteId: "11111111-1111-4111-8111-111111111111",
      documentType: "infonavit_carta_bajo_protesta",
      submissionVersion: 1,
    });
    assert.equal(ok.success, true);
    const badTipo = infonavitDocxRequestSchema.safeParse({
      expedienteId: "11111111-1111-4111-8111-111111111111",
      documentType: "pagare",
      submissionVersion: 1,
    });
    assert.equal(badTipo.success, false);
    for (const code of [
      "unauthenticated",
      "forbidden",
      "invalid_request",
      "not_done",
      "version_mismatch",
      "snapshot_missing",
    ] as const) {
      const msg = infonavitDocxPublicMessage(code);
      assert.doesNotMatch(msg, /nss|curp|rfc|payload/i);
    }
  });
});
