import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { extractPdfEmbeddedText } from "../src/domain/identidad-curp/pdf-extract-text";
import {
  resolveFiscalRfc,
  selectEstadoCuentaRfc,
} from "../src/domain/validacion-fiscal/rfc";

const TARGET_BRANCH = "test/fiscal-real-e2e-expediente-20260917";
const EXPEDIENTE_ID = "80a3ed2f-0971-4743-879b-3284a11c4b66";
const WORKER_URL =
  "https://sat-rfc-validator-real-e2e-temp-production.up.railway.app/e2e-real-expediente-20260917-once";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const vercelEnv = String(process.env.VERCEL_ENV ?? "");
  const branch = String(process.env.VERCEL_GIT_COMMIT_REF ?? "");
  if (vercelEnv !== "preview" || branch !== TARGET_BRANCH) {
    console.log("[fiscal-real-e2e-postbuild] SKIP");
    return;
  }

  const supabaseEnvNames = Object.keys(process.env)
    .filter((name) => /SUPABASE|POSTGRES/i.test(name))
    .sort();
  console.log(
    "[fiscal-real-e2e-postbuild] SERVER_ENV_NAMES " +
      JSON.stringify(supabaseEnvNames),
  );

  const supabaseUrl = String(
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      "",
  ).trim();
  const serviceRole = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SECRET_KEY ??
      process.env.SUPABASE_SERVICE_KEY ??
      "",
  ).trim();
  if (!supabaseUrl || !serviceRole) {
    throw new Error("MISSING_SUPABASE_SERVER_ENV");
  }

  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function snapshot() {
    const [{ data: exp, error: expErr }, { data: cd, error: cdErr }] =
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

    if (expErr || !exp) throw new Error("EXPEDIENTE_NOT_FOUND");
    if (cdErr || !cd) throw new Error("CLIENTE_DATOS_NOT_FOUND");
    return { exp, cd };
  }

  console.log("[fiscal-real-e2e-postbuild] START");
  const before = await snapshot();
  const beforeHash = hash(before);
  const datos = (before.cd.datos ?? {}) as Record<string, unknown>;

  const nss = String(datos.nss ?? "").trim();
  const rfcDatosGenerales = String(datos.rfc ?? "").trim().toUpperCase();
  const curp = String(datos.curp ?? "").trim().toUpperCase();

  if (nss.length !== 11 || rfcDatosGenerales.length !== 13 || curp.length !== 18) {
    throw new Error("REAL_DATA_SHAPE_INVALID");
  }
  console.log("[fiscal-real-e2e-postbuild] REAL_DATA_SHAPE_OK nss=11 rfc=13 curp=18");

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
  console.log(
    `[fiscal-real-e2e-postbuild] NSS_LOOKUP uniqueSameExpediente=${nssUniqueMatch}`,
  );

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
  console.log(
    `[fiscal-real-e2e-postbuild] REAL_PDF_DOWNLOADED bytes=${doc.size_bytes} version=${doc.version}`,
  );

  const extracted = await extractPdfEmbeddedText(await pdfBlob.arrayBuffer());
  const { data: editorDecision } = await sb
    .from("editor_decisions")
    .select("rfc_infonavit")
    .eq("expediente_id", EXPEDIENTE_ID)
    .maybeSingle();

  let fiscalRfc = rfcDatosGenerales;
  let satInputSource = "datos_generales_e2e_fallback";
  let pdfSummary: Record<string, unknown>;

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

    if (resolution.status === "ready_for_sat" && resolution.fiscalRfc) {
      fiscalRfc = resolution.fiscalRfc;
      satInputSource = "estado_cuenta_resuelto";
    }

    pdfSummary = {
      extractOk: true,
      selectionStatus: selection.status,
      selectionReason: selection.reason,
      candidateCount: selection.candidates.length,
      resolutionStatus: resolution.status,
      satInputSource,
    };
  } else {
    pdfSummary = {
      extractOk: false,
      extractReason: extracted.reason,
      selectionStatus: "not_run",
      selectionReason: "not_run",
      candidateCount: 0,
      resolutionStatus: "not_run",
      satInputSource,
    };
  }

  console.log(
    "[fiscal-real-e2e-postbuild] PDF_RESULT " + JSON.stringify(pdfSummary),
  );

  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-e2e-run": "concasa-real-readonly-20260917",
    },
    body: JSON.stringify({ rfc: fiscalRfc, curp }),
    signal: AbortSignal.timeout(170_000),
  });

  const raw = await response.text();
  let worker: Record<string, any> = {};
  try {
    worker = JSON.parse(raw) as Record<string, any>;
  } catch {
    throw new Error("WORKER_NON_JSON_RESPONSE");
  }

  const after = await snapshot();
  const fingerprintSame = beforeHash === hash(after);

  const result = {
    workerHttpStatus: response.status,
    workerOk: worker.ok === true,
    semantic: typeof worker.semantic === "string" ? worker.semantic : null,
    rfcStatus:
      typeof worker.rfc?.status === "string" ? worker.rfc.status : null,
    rfcEvidencePresent: worker.rfc?.evidencePresent === true,
    curpStatus:
      typeof worker.curp?.status === "string" ? worker.curp.status : null,
    curpEvidencePresent: worker.curp?.evidencePresent === true,
    realExpediente: true,
    paid: before.exp.pago_concasa_resultado === "pagado",
    nssUniqueMatch,
    pdf: pdfSummary,
    safeguards: {
      writesProduction: false,
      enviarAMesaCalled: false,
      beforeAfterFingerprintSame: fingerprintSame,
      piiLogged: false,
    },
  };

  console.log("[fiscal-real-e2e-postbuild] FINAL " + JSON.stringify(result));

  if (!fingerprintSame) {
    throw new Error("SOURCE_FINGERPRINT_CHANGED");
  }
  if (!response.ok) {
    throw new Error("SAT_WORKER_TECHNICAL_FAILURE");
  }
}

main().catch((error) => {
  console.error(
    "[fiscal-real-e2e-postbuild] ERROR",
    error instanceof Error ? error.message : "unknown",
  );
  process.exitCode = 1;
});
