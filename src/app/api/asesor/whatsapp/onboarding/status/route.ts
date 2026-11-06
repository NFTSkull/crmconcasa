import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const PILOT_UID = "7f5c513e-ca81-4811-a349-531b02a345d3";
const CONCASA_ORG = "50beae49-3961-4163-8e78-2251693f2c19";
const PILOT_EMAIL = "prueba@concasa.mx";
const CORRECT_PROJECT_HOST = "fvtqbxukqlajezyyvwzy.supabase.co";

function json(status: number, data: object): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

/**
 * READ ONLY: identity-bound readiness check for the owner WhatsApp Business pilot.
 * This endpoint never calls Graph API, exchanges authorization codes, connects a
 * phone, sends messages, or writes any database rows.
 */
export async function GET(request: Request): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return json(503, { error: "crm_not_configured" });
  try {
    if (new URL(url).hostname !== CORRECT_PROJECT_HOST) {
      return json(503, { error: "wrong_supabase_project" });
    }
  } catch {
    return json(503, { error: "crm_not_configured" });
  }

  const h = request.headers.get("authorization");
  const bearer = h?.startsWith("Bearer ") ? h.slice(7) : null;
  if (!bearer || bearer.length > 8192) return json(401, { error: "login_required" });

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const verified = await client.auth.getUser(bearer);
  if (verified.error || verified.data.user?.id !== PILOT_UID ||
      verified.data.user?.email?.toLowerCase() !== PILOT_EMAIL) {
    return json(403, { error: "pilot_only" });
  }

  const [p, c] = await Promise.all([
    client.from("profiles").select("id,organization_id,app_role,active")
      .eq("id", PILOT_UID).maybeSingle(),
    client.from("whatsapp_connections")
      .select("id,connection_type,connection_state,created_at")
      .order("created_at", { ascending: false }).limit(10),
  ]);
  if (p.error || c.error) return json(503, { error: "readiness_unavailable" });
  if (!p.data || p.data.organization_id !== CONCASA_ORG ||
      p.data.app_role !== "asesor" || p.data.active !== true) {
    return json(403, { error: "pilot_only" });
  }

  return json(200, {
    ready_to_connect: false,
    test_pilot: { linked: (c.data ?? []).some(x =>
      x.connection_type === "meta_test" && x.connection_state === "active"),
      messages_enabled: false,
    },
    coexistence: {
      launch_enabled: false,
      verified_connections: (c.data ?? []).filter(x => x.connection_type === "coexistence").length,
      requirements: [
        { id: "meta_app", label: "Configuración de Meta y dominio del SDK", state: "manual_review_required" },
        { id: "business", label: "Elegibilidad real de Coexistence y verificación empresarial", state: "pending" },
        { id: "legal", label: "Aviso de privacidad y eliminación de datos", state: "pending" },
        { id: "oauth", label: "Intercambio de código de Meta con sesión y almacenamiento seguro", state: "not_implemented" },
        { id: "webhooks", label: "Webhooks multicuenta, historial y mensajes desde el celular", state: "not_implemented" },
        { id: "messaging", label: "Respuestas bidireccionales con autorización por asesor", state: "not_implemented" },
      ],
    },
    message: "La vinculación real no está habilitada. Tu WhatsApp Business no ha sido modificado.",
  });
}
