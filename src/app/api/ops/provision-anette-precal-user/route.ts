import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_HASH =
  "8ab67471e560a47e62b63c4c9bbb75129fb25b6f26480320f47d463aac3cde40";
const EXPIRES_AT = Date.parse("2026-09-30T05:15:00.000Z");
const EMAIL = "precal.anette@concasa.mx";
const FULL_NAME = "PRECALIFICADOR ANETTE";
const ANETTE_ID = "8069c434-c3b6-4d09-97a6-022636f9a8a4";
const ORG_ID = "50beae49-3961-4163-8e78-2251693f2c19";

function validToken(raw: string): boolean {
  const digest = createHash("sha256").update(raw).digest();
  const expected = Buffer.from(TOKEN_HASH, "hex");
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("service_env_missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (Date.now() > EXPIRES_AT || !validToken(token)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized_or_expired" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const sb = serviceClient();

  const { data: existingProfile, error: existingProfileError } = await sb
    .from("profiles")
    .select("id,email")
    .eq("email", EMAIL)
    .maybeSingle();
  if (existingProfileError) {
    return NextResponse.json(
      { ok: false, error: "profile_lookup_failed" },
      { status: 500 },
    );
  }
  if (existingProfile) {
    return NextResponse.json(
      { ok: false, error: "profile_already_exists", id: existingProfile.id },
      { status: 409 },
    );
  }

  const { data: anette, error: anetteError } = await sb
    .from("profiles")
    .select("id")
    .eq("id", ANETTE_ID)
    .eq("organization_id", ORG_ID)
    .eq("app_role", "asesor")
    .eq("active", true)
    .maybeSingle();
  if (anetteError || !anette) {
    return NextResponse.json(
      { ok: false, error: "anette_not_active" },
      { status: 409 },
    );
  }

  const password = `${randomBytes(18).toString("base64url")}!9a`;
  const { data: authData, error: authError } = await sb.auth.admin.createUser({
    email: EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME },
  });
  if (authError || !authData.user) {
    return NextResponse.json(
      {
        ok: false,
        error: "auth_create_failed",
        detail: authError?.message ?? "unknown",
      },
      { status: 500 },
    );
  }

  const userId = authData.user.id;
  try {
    const { error: profileError } = await sb.from("profiles").insert({
      id: userId,
      organization_id: ORG_ID,
      email: EMAIL,
      full_name: FULL_NAME,
      app_role: "asesor",
      tipo_asesor_origen: "externo",
      active: true,
    });
    if (profileError) throw new Error(`profile:${profileError.message}`);

    const { error: capError } = await sb.from("profile_capabilities").insert({
      profile_id: userId,
      capability: "precalificador_nss_only",
      active: true,
    });
    if (capError) throw new Error(`capability:${capError.message}`);

    const { error: linkError } = await sb
      .from("asesor_precalificadores_ligados")
      .insert({
        precalificador_id: userId,
        asesor_titular_id: ANETTE_ID,
        active: true,
      });
    if (linkError) throw new Error(`link:${linkError.message}`);

    return NextResponse.json(
      {
        ok: true,
        id: userId,
        email: EMAIL,
        password,
        full_name: FULL_NAME,
        titular: "ANETTE PEREZ",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    await sb
      .from("asesor_precalificadores_ligados")
      .delete()
      .eq("precalificador_id", userId);
    await sb.from("profile_capabilities").delete().eq("profile_id", userId);
    await sb.from("profiles").delete().eq("id", userId);
    await sb.auth.admin.deleteUser(userId);
    return NextResponse.json(
      {
        ok: false,
        error: "provision_failed_rolled_back",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
