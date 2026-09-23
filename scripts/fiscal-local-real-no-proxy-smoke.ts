import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { extractPdfEmbeddedText } from "../src/domain/identidad-curp/pdf-extract-text";
import { validateCurpLocal } from "../src/domain/identidad-curp/curp-local";
import {
  resolveFiscalRfc,
  selectEstadoCuentaRfc,
} from "../src/domain/validacion-fiscal/rfc";
import { validateFiscalLive } from "../integrations/sat-rfc-validator/src/live-validator.js";

const CASES = [
  {
    label: "paid_validated",
    expedienteId: "80a3ed2f-0971-4743-879b-3284a11c4b66",
    expectPaid: true,
    expectRfcRejection: false,
  },
  {
    label: "rfc_rejected",
    expedienteId: "a80ade2b-39c3-4cb7-a180-254c9b6518f8",
    expectPaid: false,
    expectRfcRejection: true,
  },
] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  if (process.env.LOCAL_SMOKE_CONFIRM !== "READ_ONLY") {
    throw new Error("SET_LOCAL_SMOKE_CONFIRM_READ_ONLY");
  }

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
  const capsolverApiKey = String(process.env.CAPSOLVER_API_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRole) {
    throw new Error("MISSING_SUPABASE_SERVER_ENV");
  }
  if (!capsolverApiKey) {
    throw new Error("MISSING_CAPSOLVER_API_KEY");
  }

  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function snapshot(expedienteId: string) {
    const [
      { data: exp, error: expErr },
      { data: cd, error: cdErr },
      { data: ed, error: edErr },
    ] = await Promise.all([
      sb
        .from("expedientes")
        .select(
          "id,pago_concasa_resultado,etapa_actual,subestado,ciclo_estado,submitted_to_mesa,motivo_rechazo,comentario_rechazo,updated_at,deleted_at",
        )
        .eq("id", expedienteId)
        .maybeSingle(),
      sb
        .from("cliente_datos")
        .select("expediente_id,estado,datos,updated_at")
        .eq("expediente_id", expedienteId)
        .maybeSingle(),
      sb
        .from("editor_decisions")
        .select("expediente_id,rfc_infonavit,decision,updated_at")
        .eq("expediente_id", expedienteId)
        .maybeSingle(),
    ]);

    if (expErr || !exp) throw new Error("EXPEDIENTE_NOT_FOUND");
    if (cdErr || !cd) throw new Error("CLIENTE_DATOS_NOT_FOUND");
    if (edErr) throw new Error("EDITOR_DECISION_READ_FAILED");
    return { exp, cd, ed: ed ?? null };
  }

  async function runCase(testCase: (typeof CASES)[number]) {
    const startedAt = Date.now();
    console.log(`[fiscal-local-smoke] CASE_START label=${testCase.label}`);

    const before = await snapshot(testCase.expedienteId);
    const beforeHash = hash(before);
    const datos = (before.cd.datos ?? {}) as Record<string, unknown>;

    const rfcDatosGenerales = String(datos.rfc ?? "").trim().toUpperCase();
    const curp = String(datos.curp ?? "").trim().toUpperCase();

    const curpLocal = validateCurpLocal({ curp });
    if (curpLocal.status !== "VALIDA_LOCALMENTE") {
      throw new Error(`${testCase.label}:CURP_LOCAL_INVALIDA`);
    }

    const rejectionText = [
      String(before.exp.motivo_rechazo ?? ""),
      String(before.exp.comentario_rechazo ?? ""),
    ].join(" ");
    const hasRfcRejection = /RFC/i.test(rejectionText);

    if (testCase.expectRfcRejection && !hasRfcRejection) {
      throw new Error(`${testCase.label}:EXPECTED_RFC_REJECTION_NOT_FOUND`);
    }
    if (testCase.expectPaid && before.exp.pago_concasa_resultado !== "pagado") {
      throw new Error(`${testCase.label}:EXPECTED_PAID_NOT_FOUND`);
    }

    const { data: doc, error: docError } = await sb
      .from("expediente_documentos")
      .select("id,storage_path,mime_type,size_bytes,version,created_at,updated_at")
      .eq("expediente_id", testCase.expedienteId)
      .eq("tipo_documento", "cliente_estado_cuenta")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (docError || !doc?.storage_path) {
      throw new Error(`${testCase.label}:ESTADO_CUENTA_NOT_FOUND`);
    }

    const { data: pdfBlob, error: downloadError } = await sb.storage
      .from("expediente-documentos")
      .download(String(doc.storage_path));

    if (downloadError || !pdfBlob) {
      throw new Error(`${testCase.label}:ESTADO_CUENTA_DOWNLOAD_FAILED`);
    }

    const extracted = await extractPdfEmbeddedText(await pdfBlob.arrayBuffer());
    if (!extracted.ok) {
      throw new Error(`${testCase.label}:${extracted.reason}`);
    }

    const selection = selectEstadoCuentaRfc({
      text: extracted.text,
      rfcInfonavit: String(before.ed?.rfc_infonavit ?? ""),
      rfcDatosGenerales,
      curpValidadaLocalmente: curpLocal.normalized,
    });

    const resolution = resolveFiscalRfc({
      rfcInfonavit: String(before.ed?.rfc_infonavit ?? ""),
      rfcDatosGenerales,
      estadoCuenta: selection,
    });

    if (resolution.status !== "ready_for_sat" || !resolution.fiscalRfc) {
      throw new Error(
        `${testCase.label}:RFC_NOT_READY_FOR_SAT:${resolution.status}`,
      );
    }

    const satStartedAt = Date.now();
    const sat = await validateFiscalLive({
      rfc: resolution.fiscalRfc,
      curp: curpLocal.normalized,
      capsolverApiKey,
      proxy: undefined,
    });
    const satMs = Date.now() - satStartedAt;

    const after = await snapshot(testCase.expedienteId);
    const fingerprintSame = beforeHash === hash(after);

    const safeResult = {
      label: testCase.label,
      source: {
        paid: before.exp.pago_concasa_resultado === "pagado",
        clienteDatosEstado: before.cd.estado,
        hasRfcRejection,
        submittedToMesa: before.exp.submitted_to_mesa === true,
        cicloEstado: before.exp.ciclo_estado,
      },
      estadoCuenta: {
        version: doc.version,
        mimeType: doc.mime_type,
        selectionStatus: selection.status,
        selectionReason: selection.reason,
        candidateCount: selection.candidates.length,
        resolutionStatus: resolution.status,
        rfcRelationInfonavit: resolution.infonavitRelation,
        rfcRelationDatosGenerales: resolution.datosGeneralesRelation,
      },
      sat: {
        semantic: sat.semantic,
        ok: sat.ok,
        rfcStatus: sat.rfc?.status ?? null,
        rfcEvidencePresent: Boolean(sat.rfc?.evidence),
        curpStatus: sat.curp?.status ?? null,
        curpEvidencePresent: Boolean(sat.curp?.evidence),
        elapsedMs: satMs,
      },
      safeguards: {
        proxyUsed: false,
        writesProduction: false,
        enviarAMesaCalled: false,
        beforeAfterFingerprintSame: fingerprintSame,
        piiLogged: false,
      },
      totalElapsedMs: Date.now() - startedAt,
    };

    console.log(
      "[fiscal-local-smoke] CASE_RESULT " + JSON.stringify(safeResult),
    );

    if (!fingerprintSame) {
      throw new Error(`${testCase.label}:SOURCE_FINGERPRINT_CHANGED`);
    }

    return safeResult;
  }

  console.log(
    "[fiscal-local-smoke] START cases=2 proxy=disabled writes=false pii=false",
  );

  const results = [];
  for (const testCase of CASES) {
    results.push(await runCase(testCase));
  }

  console.log(
    "[fiscal-local-smoke] FINAL " +
      JSON.stringify({
        ok: true,
        cases: results,
        safeguards: {
          proxyUsed: false,
          writesProduction: false,
          enviarAMesaCalled: false,
          piiLogged: false,
        },
      }),
  );
}

main().catch((error) => {
  console.error(
    "[fiscal-local-smoke] ERROR",
    error instanceof Error ? error.message : "unknown",
  );
  process.exitCode = 1;
});
