import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("POST /api/mesa/infonavit-docx contrato", () => {
  const routeSrc = readFileSync(
    join(process.cwd(), "src/app/api/mesa/infonavit-docx/route.ts"),
    "utf8",
  );
  const serverSrc = readFileSync(
    join(process.cwd(), "src/domain/expediente-archivos/infonavit-docx-server.ts"),
    "utf8",
  );
  const sharedSrc = readFileSync(
    join(
      process.cwd(),
      "src/components/mesa-control/infonavit-pdf-documentos-shared.tsx",
    ),
    "utf8",
  );

  it("es server-side Node, genera en memoria y no escribe Storage", () => {
    assert.match(routeSrc, /export const runtime = "nodejs"/);
    assert.match(routeSrc, /export async function POST/);
    assert.match(routeSrc, /authorizeInfonavitDocxDownload/);
    assert.match(routeSrc, /infonavitDocxRequestSchema/);
    assert.match(routeSrc, /loadExactSnapshotPayload/);
    assert.match(routeSrc, /generateInfonavitDocxFromPayload/);
    assert.match(routeSrc, /Content-Disposition/);
    assert.match(routeSrc, /attachment/);
    assert.match(routeSrc, /INFONAVIT_DOCX_MIME/);
    assert.doesNotMatch(routeSrc, /storage\.from|upload\(/);
    assert.doesNotMatch(routeSrc, /expediente_documentos/);
    assert.doesNotMatch(routeSrc, /console\.(log|info|debug|error)/);
  });

  it("service_role solo en servidor; cliente no envía payload PII", () => {
    assert.match(serverSrc, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(serverSrc, /createServiceSupabaseClient/);
    assert.doesNotMatch(sharedSrc, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(sharedSrc, /payload/);
    assert.match(sharedSrc, /submissionVersion: version/);
    assert.doesNotMatch(sharedSrc, /service_role/);
  });

  it("JWT + RPC visibilidad ocurren antes de service_role / snapshot", () => {
    const jwtRpcAt = routeSrc.indexOf(
      "const estadoRes = await fetchInfonavitPdfEstadoAsUser",
    );
    const authzAt = routeSrc.indexOf("if (!decision.ok)");
    const serviceCallAt = routeSrc.indexOf(
      "service = createServiceSupabaseClient",
    );
    const loadAt = routeSrc.indexOf(
      "const payload = await loadExactSnapshotPayload",
    );
    assert.ok(jwtRpcAt > 0);
    assert.ok(authzAt > jwtRpcAt);
    assert.ok(serviceCallAt > authzAt);
    assert.ok(loadAt > serviceCallAt);
    assert.match(serverSrc, /get_expediente_infonavit_pdf_estado/);
    assert.match(serverSrc, /createUserSupabaseClient/);
  });
});
