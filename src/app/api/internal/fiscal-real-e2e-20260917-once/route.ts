import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractPdfEmbeddedText } from "@/domain/identidad-curp/pdf-extract-text";
import {
  resolveFiscalRfc,
  selectEstadoCuentaRfc,
} from "@/domain/validacion-fiscal/rfc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EXPEDIENTE_ID = "80a3ed2f-0971-4743-879b-3284a11c4b66";
const WORKER_URL =
  "https://sat-rfc-validator-real-e2e-temp-production.up.railway.app/e2e-real-expediente-20260917-once";

let consumed = false;

function serverClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("MISSING_SUPABASE_SERVER_ENV");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hashSnapshot(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function loadSnapshot(sb: ReturnType<typeof serverClient>) {
  const [{ data: expediente, error: expError }, { data: cliente, error: clienteError }] =
    await Promise.all([
      sb
        .from("expedientes")
        .select(
          "id,pago_concasa_resultado,etapa_actual,subestado,submitted_to_mesa,updated_at,deleted_at",
        )
        .eq("id", EXPEDIENTE_ID)
        .maybeSingle(),
      sb
        .from("cliente_datos")
        .select("expediente_id,datos,updated_at")
        .eq("expediente_id", EXPEDIENTE_ID)
        .maybeSingle(),
    ]);

  if (expError || !expediente) throw new Error("EXPEDIENTE_NOT_FOUND");
  if (clienteError || !cliente) throw new Error("CLIENTE_DATOS_NOT_FOUND");

  return { expediente, cliente };
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }
  if (consumed) {
    return NextResponse.json({ ok: false, code: "E2E_ALREADY_CONSUMED" }, { status: 410 });
  }
  consumed = true;

  const sb = serverClient();

  try {
    console.log("[fiscal-real-e2e] START");

    const before = await loadSnapshot(sb);
    const beforeHash = hashSnapshot(before);
    const datos = (before.cliente.datos ?? {}) as Record<string, unknown>;

    const nss = String(datos.nss ?? "").trim();
    const rfcDatosGenerales = String(datos.rfc ?? "").trim().toUpperCase();
    const curp = String(datos.curp ?? "").trim().toUpperCase();

    const shapeOk = nss.length === 11 && rfcDatosGenerales.length === 13 && curp.length === 18;
    if (!shapeOk) {
      return NextResponse.json(
        {
          ok: false,
          code: "REAL_DATA_SHAPE_INVALID",
          realExpediente: true,
          nssPresent: nss.length > 0,
          nssLength: nss.length,
          rfcLength: rfcDatosGenerales.length,
          curpLength: curp.length,
          writesProduction: false,
        },
        { status: 409 },
      );
    }

    const { data: nssMatches, error: nssError } = await sb
      .from("cliente_datos")
      .select("expediente_id")
      .contains("datos", { nss })
      .limit(2);
    if (nssError) throw new Error("NSS_LOOKUP_FAILED");

    const nssUniqueMatch =
      Array.isArray(nssMatches) &&
      nssMatches.length === 1 &&
      String(nssMatches[0]?.expediente_id ?? "") === EXPEDIENTE_ID;

    const { data: doc, error: docError } = await sb
      .from("expediente_documentos")
      .select("id,storage_path,mime_type,size_bytes,version,created_at,updated_at")
      .eq("expediente_id", EXPEDIENTE_ID)
      .eq("tipo_documento", "cliente_estado_cuenta")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (docError || !doc?.storage_path) throw new Error("ESTADO_CUENTA_NOT_FOUND");

    const { data: pdfBlob, error: downloadError } = await sb.storage
      .from("expediente-documentos")
      .download(String(doc.storage_path));
    if (downloadError || !pdfBlob) throw new Error("ESTADO_CUENTA_DOWNLOAD_FAILED");

    console.log("[fiscal-real-e2e] REAL_PDF_DOWNLOADED");

    const extracted = await extractPdfEmbeddedText(await pdfBlob.arrayBuffer());
    const { data: editorDecision } = await sb
      .from("editor_decisions")
      .select("rfc_infonavit")
      .eq("expediente_id", EXPEDIENTE_ID)
      .maybeSingle();

    let pdfResult:
      | {
          extractOk: true;
          selectionStatus: string;
          selectionReason: string;
          candidateCount: number;
          resolutionStatus: string;
          satInputSource: "estado_cuenta_resuelto" | "datos_generales_e2e_fallback";
          fiscalRfc: string;
        }
      | {
          extractOk: false;
          extractReason: string;
          selectionStatus: "not_run";
          selectionReason: "not_run";
          candidateCount: 0;
          resolutionStatus: "not_run";
          satInputSource: "datos_generales_e2e_fallback";
          fiscalRfc: string;
        };

    if (extracted.ok) {
      const selection = selectEstadoCuentaRfc({
        text: extracted.text,
        rfcInfonavit: String(editorDecision?.rfc_infonavit ?? ""),
        rfcDatosGenerales,
        curpValidadaLocalmente: curp,
      });
      const resolution = resolveFiscalRfc({
        rfcInfonavit: String(editorDecision?.rfc_infonavit ?? ""),
        rfcDatosGenerales,
        estadoCuenta: selection,
      });

      const fiscalRfc =
        resolution.status === "ready_for_sat" && resolution.fiscalRfc
          ? resolution.fiscalRfc
          : rfcDatosGenerales;

      pdfResult = {
        extractOk: true,
        selectionStatus: selection.status,
        selectionReason: selection.reason,
        candidateCount: selection.candidates.length,
        resolutionStatus: resolution.status,
        satInputSource:
          resolution.status === "ready_for_sat" && resolution.fiscalRfc
            ? "estado_cuenta_resuelto"
            : "datos_generales_e2e_fallback",
        fiscalRfc,
      };
    } else {
      pdfResult = {
        extractOk: false,
        extractReason: extracted.reason,
        selectionStatus: "not_run",
        selectionReason: "not_run",
        candidateCount: 0,
        resolutionStatus: "not_run",
        satInputSource: "datos_generales_e2e_fallback",
        fiscalRfc: rfcDatosGenerales,
      };
    }

    console.log(
      `[fiscal-real-e2e] PDF_RESULT extract=${pdfResult.extractOk} source=${pdfResult.satInputSource}`,
    );

    const workerResponse = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-e2e-run": "concasa-real-readonly-20260917",
      },
      body: JSON.stringify({
        rfc: pdfResult.fiscalRfc,
        curp,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(170_000),
    });

    const workerRaw = await workerResponse.text();
    let worker: Record<string, unknown> = {};
    try {
      worker = JSON.parse(workerRaw) as Record<string, unknown>;
    } catch {
      worker = {};
    }

    const rfcResult = (worker.rfc ?? {}) as Record<string, unknown>;
    const curpResult = (worker.curp ?? {}) as Record<string, unknown>;

    const after = await loadSnapshot(sb);
    const afterHash = hashSnapshot(after);

    console.log("[fiscal-real-e2e] END");

    return NextResponse.json({
      ok: workerResponse.ok && worker.ok === true,
      realExpediente: true,
      paid: before.expediente.pago_concasa_resultado === "pagado",
      nssPresent: true,
      nssLength: nss.length,
      nssUniqueMatch,
      estadoCuenta: {
        found: true,
        mimeType: doc.mime_type,
        sizeBytes: doc.size_bytes,
        version: doc.version,
        extractOk: pdfResult.extractOk,
        extractReason: "extractReason" in pdfResult ? pdfResult.extractReason : null,
        selectionStatus: pdfResult.selectionStatus,
        selectionReason: pdfResult.selectionReason,
        candidateCount: pdfResult.candidateCount,
        resolutionStatus: pdfResult.resolutionStatus,
        satInputSource: pdfResult.satInputSource,
      },
      sat: {
        httpStatus: workerResponse.status,
        semantic: typeof worker.semantic === "string" ? worker.semantic : null,
        rfcStatus: typeof rfcResult.status === "string" ? rfcResult.status : null,
        rfcEvidencePresent: rfcResult.evidencePresent === true,
        curpStatus: typeof curpResult.status === "string" ? curpResult.status : null,
        curpEvidencePresent: curpResult.evidencePresent === true,
      },
      safeguards: {
        writesProduction: false,
        enviarAMesaCalled: false,
        beforeAfterFingerprintSame: beforeHash === afterHash,
        piiReturned: false,
      },
    });
  } catch (error) {
    console.error(
      "[fiscal-real-e2e] ERROR",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      {
        ok: false,
        code: error instanceof Error ? error.message : "E2E_TECHNICAL",
        realExpediente: true,
        writesProduction: false,
        enviarAMesaCalled: false,
        piiReturned: false,
      },
      { status: 500 },
    );
  }
}
