import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ONE_OFF_KEY = "vSGcN4rYDJNe3LUCk-PLcLzWi2snSlFzzgdRD_0C62E";

const TARGETS = [
  { key: "luz_case", id: "8c09a026-51d0-4bd9-bcce-4fd3a17873a1" },
  { key: "laura_case", id: "6b99c79a-1348-4f4b-9751-84ce00f197de" },
] as const;

type WorkerBody = {
  ok?: boolean;
  semantic?: "pass" | "invalid" | "retry";
  code?: string;
  rfc?: { status?: string };
  curp?: { status?: string };
};

function normalized(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function fail(code: string, status = 500) {
  return NextResponse.json(
    { ok: false, code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("key") !== ONE_OFF_KEY) {
    return fail("NOT_FOUND", 404);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const workerUrl = process.env.SAT_VALIDATOR_URL?.trim().replace(/\/+$/, "");
  const workerSecret = process.env.SAT_VALIDATOR_SECRET?.trim();

  if (!supabaseUrl || !serviceRole || !workerUrl || !workerSecret) {
    return fail("ENV_NOT_CONFIGURED", 503);
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Array<Record<string, unknown>> = [];

  for (const target of TARGETS) {
    const { data: expediente, error: expError } = await admin
      .from("expedientes")
      .select("id, organization_id, submitted_to_mesa, ciclo_estado")
      .eq("id", target.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (expError || !expediente) {
      results.push({ key: target.key, ok: false, code: "EXPEDIENTE_READ_FAILED" });
      continue;
    }

    if (expediente.submitted_to_mesa) {
      results.push({ key: target.key, ok: true, status: "already_sent" });
      continue;
    }

    if (expediente.ciclo_estado !== "activo") {
      results.push({ key: target.key, ok: false, code: "CICLO_NO_ACTIVO" });
      continue;
    }

    const [
      { data: editor, error: editorError },
      { data: cliente, error: clienteError },
      { data: edc, error: edcError },
      { data: superAdmin, error: adminError },
    ] = await Promise.all([
      admin
        .from("editor_decisions")
        .select("rfc_infonavit")
        .eq("expediente_id", target.id)
        .maybeSingle(),
      admin
        .from("cliente_datos")
        .select("datos")
        .eq("expediente_id", target.id)
        .maybeSingle(),
      admin
        .from("expediente_documentos")
        .select("id, version")
        .eq("expediente_id", target.id)
        .eq("tipo_documento", "cliente_estado_cuenta")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("version", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("id")
        .eq("organization_id", expediente.organization_id)
        .eq("app_role", "super_admin")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (
      editorError ||
      clienteError ||
      edcError ||
      adminError ||
      !editor ||
      !cliente?.datos ||
      !edc?.id ||
      !superAdmin?.id
    ) {
      results.push({ key: target.key, ok: false, code: "INPUTS_INCOMPLETE" });
      continue;
    }

    const datos = cliente.datos as Record<string, unknown>;
    const rfcInfonavit = normalized(editor.rfc_infonavit);
    const rfcDatos = normalized(datos.rfc);
    const curp = normalized(datos.curp);

    if (
      rfcInfonavit.length !== 13 ||
      rfcDatos.length !== 13 ||
      curp.length !== 18 ||
      rfcInfonavit !== rfcDatos ||
      rfcInfonavit.slice(0, 10) !== curp.slice(0, 10)
    ) {
      results.push({
        key: target.key,
        ok: false,
        code: "RFC_CURP_CORROBORATION_FAILED",
      });
      continue;
    }

    let workerResponse: Response;
    let workerBody: WorkerBody | null = null;
    try {
      workerResponse = await fetch(`${workerUrl}/validate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-concasa-worker-secret": workerSecret,
        },
        body: JSON.stringify({ rfc: rfcInfonavit, curp }),
        cache: "no-store",
        signal: AbortSignal.timeout(50_000),
      });
      workerBody = (await workerResponse.json().catch(() => null)) as WorkerBody | null;
    } catch {
      results.push({ key: target.key, ok: false, code: "SAT_WORKER_EXCEPTION" });
      continue;
    }

    const satPass =
      workerResponse.ok &&
      workerBody?.semantic === "pass" &&
      workerBody?.rfc?.status === "valid" &&
      workerBody?.curp?.status === "valid";

    if (!satPass) {
      results.push({
        key: target.key,
        ok: false,
        code: workerBody?.code || "SAT_NOT_VALIDATED",
        semantic: workerBody?.semantic || null,
        rfc_status: workerBody?.rfc?.status || null,
        curp_status: workerBody?.curp?.status || null,
      });
      continue;
    }

    const { error: registerError } = await admin.rpc(
      "server_registrar_validacion_fiscal_sat",
      {
        p_expediente_id: target.id,
        p_estado: "RFC_VALIDACION_SAT_VALIDADO",
        p_resultado_resumido: {
          source: "sat_worker",
          semantic: "pass",
          rfc_source: "respaldo_capturado",
          backup_reason: "oneoff_recovery_after_document_read_issue",
          backup_field: "rfc_infonavit",
        },
        p_fiscal_rfc: rfcInfonavit,
        p_edc_documento_id: edc.id,
        p_edc_version: Number(edc.version ?? 0),
      },
    );

    if (registerError) {
      results.push({
        key: target.key,
        ok: false,
        code: "REGISTER_VALIDATION_FAILED",
        detail: registerError.code || null,
      });
      continue;
    }

    const { data: sent, error: sendError } = await admin.rpc("enviar_a_mesa_core", {
      p_expediente_id: target.id,
      p_actor_id: superAdmin.id,
      p_actor_role: "super_admin",
    });

    if (sendError) {
      results.push({
        key: target.key,
        ok: false,
        code: "SEND_TO_MESA_FAILED",
        detail: sendError.message || sendError.code || null,
      });
      continue;
    }

    results.push({
      key: target.key,
      ok: true,
      status: "sent",
      submitted_to_mesa:
        typeof sent === "object" && sent !== null
          ? Boolean((sent as Record<string, unknown>).submitted_to_mesa)
          : true,
    });
  }

  return NextResponse.json(
    {
      ok: results.every((item) => item.ok === true),
      results,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
