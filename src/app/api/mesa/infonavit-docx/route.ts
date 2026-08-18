/**
 * POST /api/mesa/infonavit-docx
 * Mesa-only. Genera DOCX en memoria desde el snapshot exacto.
 * 0 Storage. 0 service_role en el browser.
 */

import { NextResponse } from "next/server";
import {
  authorizeInfonavitDocxDownload,
  INFONAVIT_DOCX_MIME,
  infonavitDocxRequestSchema,
  type InfonavitDocxDenyCode,
} from "@/domain/expediente-archivos/infonavit-docx-download";
import {
  createServiceSupabaseClient,
  createUserSupabaseClient,
  fetchCallerProfile,
  fetchInfonavitPdfEstadoAsUser,
  generateInfonavitDocxFromPayload,
  loadExactSnapshotPayload,
} from "@/domain/expediente-archivos/infonavit-docx-server";

export const runtime = "nodejs";

function jsonError(
  status: number,
  code: InfonavitDocxDenyCode | "unavailable",
  message: string,
) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

function bearerToken(req: Request): string | null {
  const raw = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!raw) return null;
  const m = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return jsonError(401, "unauthenticated", "No hay sesión activa.");
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(400, "invalid_request", "Solicitud inválida.");
  }
  const parsed = infonavitDocxRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "invalid_request", "Solicitud inválida.");
  }
  const { expedienteId, documentType, submissionVersion } = parsed.data;

  let userClient;
  try {
    userClient = createUserSupabaseClient(token);
  } catch {
    return jsonError(403, "forbidden", "No se puede descargar el Word editable.");
  }

  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return jsonError(401, "unauthenticated", "No hay sesión activa.");
  }

  const profile = await fetchCallerProfile(userClient, userData.user.id);
  const estadoRes = await fetchInfonavitPdfEstadoAsUser(userClient, expedienteId);
  const canSee = !estadoRes.denied;
  const estado = estadoRes.denied ? null : estadoRes.estado;
  const doc = estado?.documents.find((d) => d.document_type === documentType);

  const decision = authorizeInfonavitDocxDownload({
    authenticated: true,
    appRole: profile.appRole,
    active: profile.active,
    canSeeExpediente: canSee,
    aplica: estado?.aplica === true,
    hasSubmission: estado?.has_submission === true,
    estadoSubmissionVersion: estado?.submission_version ?? null,
    requestedSubmissionVersion: submissionVersion,
    documentType,
    documentStatus: doc?.status ?? null,
  });

  if (!decision.ok) {
    return jsonError(decision.httpStatus, decision.code, decision.message);
  }

  let service;
  try {
    service = createServiceSupabaseClient();
  } catch {
    return jsonError(403, "forbidden", "No se puede descargar el Word editable.");
  }

  const payload = await loadExactSnapshotPayload({
    service,
    expedienteId,
    submissionVersion: decision.submissionVersion,
  });
  if (payload == null) {
    return jsonError(404, "snapshot_missing", "No se encontró el documento editable.");
  }

  let bytes: Uint8Array;
  try {
    bytes = await generateInfonavitDocxFromPayload(payload, decision.b1Type);
  } catch {
    return jsonError(409, "snapshot_missing", "No se encontró el documento editable.");
  }

  const filename = decision.filename.replace(/"/g, "");
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": INFONAVIT_DOCX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
