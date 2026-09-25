import { NextResponse } from "next/server";
import {
  AdminFiscalAprobarBodySchema,
  authorizeSuperAdmin,
  mapAprobarRpcError,
} from "@/domain/validacion-fiscal/admin-aprobar-envio-mesa";
import {
  bearerToken,
  createUserSupabaseClient,
  fetchCallerProfile,
} from "@/domain/validacion-fiscal/admin-fiscal-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
    }

    const parsed = AdminFiscalAprobarBodySchema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION",
          message: first?.message ?? "Payload inválido",
        },
        { status: 400 },
      );
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

    const { data, error } = await userClient.rpc("admin_aprobar_envio_mesa_sin_fiscal", {
      p_expediente_id: parsed.data.expedienteId,
      p_motivo: parsed.data.motivo,
    });

    if (error) {
      const mapped = mapAprobarRpcError(error.message ?? "", error.code);
      return NextResponse.json(
        { ok: false, code: mapped.code, message: mapped.message },
        { status: mapped.status },
      );
    }

    return NextResponse.json({ ok: true, result: data ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "supabase_not_configured") {
      return NextResponse.json({ ok: false, code: "CONFIG" }, { status: 503 });
    }
    console.error("[admin/fiscal-aprobar-envio-mesa] unexpected", msg);
    return NextResponse.json({ ok: false, code: "UNEXPECTED" }, { status: 500 });
  }
}
