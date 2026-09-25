import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createUserSupabaseClient(accessToken: string): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anon) throw new Error("supabase_not_configured");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function createServiceSupabaseClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("supabase_service_not_configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function fetchCallerProfile(
  userClient: SupabaseClient,
  userId: string,
): Promise<{ appRole: string | null; active: boolean }> {
  const { data, error } = await userClient
    .from("profiles")
    .select("app_role, active")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return { appRole: null, active: false };
  const row = data as { app_role?: unknown; active?: unknown };
  return {
    appRole: typeof row.app_role === "string" ? row.app_role : null,
    active: row.active === true,
  };
}

export function bearerToken(req: Request): string | null {
  const raw = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!raw) return null;
  const m = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return m?.[1] ?? null;
}
