import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ONE_OFF_KEY = "q9Y1bL6oN7sV4tK2mP8xR5cD3fH0jW4z";

const TARGETS = [
  { key: "francisco_alejandro", id: "a223a4e3-63dc-4ee9-ab71-c78fbe9416d4" },
  { key: "jacinto_hernandez", id: "932e2464-45b8-4625-8052-9b01982d978c" },
  { key: "juan_daniel", id: "708dcc1f-eac8-4d0f-b02b-f5372e5a3a33" },
  { key: "rocio_judith", id: "28d81bf9-4faf-4ec3-920a-9f7b94d32e13" },
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

  const targetKey = request.nextUrl.searchParams.get("target")?.trim() || "";
  const selectedTargets = targetKey
    ? TARGETS.filter((target) => target.key === targetKey)
    : TARGETS;

  if (targetKey && selectedTargets.length === 0) {
    return fail("TARGET_NOT_FOUND", 404);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const target of selectedTargets) {
    const { data: expediente, error: expError } = await admin
      .from("expedientes")
      .select("id, organization_id, cliente_nombre, submitted_to_mesa, ciclo_estado")
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
      { data: cliente, error: clienteError },
      { data: edc, error: edcError },
      { data: superAdmin, error: adminError },
    ] = await Promise.all([
      admin
        .from("cliente_datos")
        .select("datos, estado")
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
      clienteError ||
      edcError ||
      adminError ||
      !cliente?.datos ||
      !edc?.id ||
      !superAdmin?.id
    ) {
      results.push({ key: target.key, ok: false, code: "INPUTS_INCOMPLETE" });
      continue;
    }

    const { data: ocrCache, error: ocrError } = await admin
      .from("document_ocr_cache")
      .select("status, fiscal_rfc, fiscal_rfc_status")
      .eq("documento_id", edc.id)
      .maybeSingle();

    if (
      ocrError ||
      ocrCache?.status !== "done" ||
      ocrCache?.fiscal_rfc_status !== "ready"
    ) {
      results.push({ key: target.key, ok: false, code: "FISCAL_RFC_CACHE_NOT_READY" });
      continue;
    }

    const datos = cliente.datos as Record<string, unknown>;
    const curp = normalized(datos.curp);
    const fiscalRfc = normalized(ocrCache.fiscal_rfc);

    if (
      fiscalRfc.length !== 13 ||
      curp.length !== 18 ||
      fiscalRfc.slice(0, 10) !== curp.slice(0, 10)
    ) {
      results.push({ key: target.key, ok: false, code: "RFC_CURP_CORROBORATION_FAILED" });
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
        body: JSON.stringify({ rfc: fiscalRfc, curp }),
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
      if (
        workerBody?.semantic === "invalid" &&
        (workerBody?.rfc?.status === "invalid" || workerBody?.curp?.status === "invalid")
      ) {
        const invalidCode =
          workerBody?.rfc?.status === "invalid" ? "RFC_INVALIDO_SAT" : "CURP_INVALIDA_SAT";

        const { error: invalidRegisterError } = await admin.rpc(
          "server_registrar_validacion_fiscal_sat",
          {
            p_expediente_id: target.id,
            p_estado: "RFC_VALIDACION_SAT_INVALIDO",
            p_resultado_resumido: {
              source: "sat_worker",
              semantic: "invalid",
              code: invalidCode,
              recovery: "oneoff_20260928",
            },
            p_fiscal_rfc: fiscalRfc,
            p_edc_documento_id: edc.id,
            p_edc_version: Number(edc.version ?? 0),
          },
        );

        results.push({
          key: target.key,
          ok: false,
          status: "invalid",
          code: invalidRegisterError ? "REGISTER_INVALID_FAILED" : invalidCode,
        });
        continue;
      }

      results.push({
        key: target.key,
        ok: false,
        status: "retry",
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
          rfc_source: "estado_cuenta",
          recovery: "oneoff_20260928",
        },
        p_fiscal_rfc: fiscalRfc,
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
    { ok: results.every((item) => item.ok === true), results },
    { headers: { "cache-control": "no-store" } },
  );
}
