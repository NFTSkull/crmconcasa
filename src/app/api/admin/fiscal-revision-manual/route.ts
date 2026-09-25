import { NextResponse } from "next/server";
import {
  assertNoPiiInItem,
  authorizeSuperAdmin,
  extractMotivoResumen,
  FISCAL_REVISION_MANUAL_ESTADO,
  maskNss,
  type AdminFiscalRevisionManualItem,
} from "@/domain/validacion-fiscal/admin-aprobar-envio-mesa";
import {
  bearerToken,
  createServiceSupabaseClient,
  createUserSupabaseClient,
  fetchCallerProfile,
} from "@/domain/validacion-fiscal/admin-fiscal-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ValidacionJoinRow = {
  expediente_id: string;
  estado: string | null;
  resultado_resumido: unknown;
  realizado_at: string | null;
  created_at: string | null;
  expedientes: {
    id: string;
    cliente_nombre: string | null;
    nss: string | null;
    submitted_to_mesa: boolean | null;
    deleted_at: string | null;
    asesor_id: string | null;
  } | null;
};

export async function GET(req: Request) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }

    const userClient = createUserSupabaseClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData.user?.id) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }

    const profile = await fetchCallerProfile(userClient, authData.user.id);
    if (!authorizeSuperAdmin(profile.appRole, profile.active)) {
      return NextResponse.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
    }

    const service = createServiceSupabaseClient();
    const { data, error } = await service
      .from("cliente_validaciones_identidad")
      .select(
        `
        expediente_id,
        estado,
        resultado_resumido,
        realizado_at,
        created_at,
        expedientes!inner (
          id,
          cliente_nombre,
          nss,
          submitted_to_mesa,
          deleted_at,
          asesor_id
        )
      `,
      )
      .eq("tipo", "rfc_validacion_sat")
      .eq("vigente", true)
      .eq("estado", FISCAL_REVISION_MANUAL_ESTADO)
      .is("expedientes.deleted_at", null)
      .order("realizado_at", { ascending: false, nullsFirst: false })
      .limit(100);

    if (error) {
      console.error("[admin/fiscal-revision-manual] query_failed", error.message);
      return NextResponse.json({ ok: false, code: "QUERY_FAILED" }, { status: 503 });
    }

    const rows = (data ?? []) as unknown as ValidacionJoinRow[];
    const asesorIds = [
      ...new Set(
        rows
          .map((r) => r.expedientes?.asesor_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    const asesorNombreById = new Map<string, string>();
    if (asesorIds.length > 0) {
      const { data: profiles } = await service
        .from("profiles")
        .select("id, full_name, email")
        .in("id", asesorIds);
      for (const p of profiles ?? []) {
        const row = p as { id?: string; full_name?: string | null; email?: string | null };
        if (!row.id) continue;
        const name = (row.full_name || row.email || "").trim() || "—";
        asesorNombreById.set(row.id, name);
      }
    }

    const items: AdminFiscalRevisionManualItem[] = [];
    for (const row of rows) {
      const exp = row.expedientes;
      if (!exp || exp.deleted_at) continue;
      if (exp.submitted_to_mesa === true) continue;
      const item: AdminFiscalRevisionManualItem = {
        expedienteId: row.expediente_id,
        clienteNombre: (exp.cliente_nombre || "").trim() || "Sin nombre",
        nssMasked: maskNss(exp.nss),
        asesorNombre: asesorNombreById.get(exp.asesor_id ?? "") ?? "—",
        motivoResumen: extractMotivoResumen(row.resultado_resumido),
        realizadoAt: row.realizado_at ?? row.created_at,
        submittedToMesa: false,
      };
      assertNoPiiInItem(item);
      items.push(item);
    }

    return NextResponse.json({ ok: true, items, count: items.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "supabase_not_configured" || msg === "supabase_service_not_configured") {
      return NextResponse.json({ ok: false, code: "CONFIG" }, { status: 503 });
    }
    if (msg === "pii_rfc_leaked" || msg === "pii_curp_leaked") {
      console.error("[admin/fiscal-revision-manual] pii_guard", msg);
      return NextResponse.json({ ok: false, code: "PII_GUARD" }, { status: 500 });
    }
    console.error("[admin/fiscal-revision-manual] unexpected", msg);
    return NextResponse.json({ ok: false, code: "UNEXPECTED" }, { status: 500 });
  }
}
