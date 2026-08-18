/**
 * Server-only: carga snapshot P189 y genera DOCX en memoria.
 * Service role NUNCA se exporta al browser.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateInfonavitDocx } from "../../../supabase/functions/_shared/infonavit-pdf/generate-infonavit-docx.ts";
import { adaptB3SnapshotToB1 } from "../../../supabase/functions/_shared/infonavit-pdf/snapshot-adapter.ts";
import type { InfonavitDocumentType } from "../../../supabase/functions/_shared/infonavit-pdf/types.ts";
import {
  parseInfonavitPdfEstado,
  type InfonavitPdfEstado,
} from "./infonavit-pdf-estado";

export function createUserSupabaseClient(accessToken: string): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anon) {
    throw new Error("supabase_not_configured");
  }
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function createServiceSupabaseClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) {
    throw new Error("supabase_service_not_configured");
  }
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

export async function fetchInfonavitPdfEstadoAsUser(
  userClient: SupabaseClient,
  expedienteId: string,
): Promise<{ estado: InfonavitPdfEstado | null; denied: boolean }> {
  const { data, error } = await userClient.rpc(
    "get_expediente_infonavit_pdf_estado",
    { p_expediente_id: expedienteId },
  );
  if (error) {
    const code = String(error.code ?? "");
    if (code === "42501" || /not authenticated/i.test(error.message ?? "")) {
      return { estado: null, denied: true };
    }
    return { estado: null, denied: true };
  }
  return { estado: parseInfonavitPdfEstado(data), denied: false };
}

export async function loadExactSnapshotPayload(args: {
  service: SupabaseClient;
  expedienteId: string;
  submissionVersion: number;
}): Promise<unknown | null> {
  const { data, error } = await args.service
    .from("expediente_infonavit_submission_snapshots")
    .select("payload, submission_version")
    .eq("expediente_id", args.expedienteId)
    .eq("submission_version", args.submissionVersion)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { payload?: unknown; submission_version?: unknown };
  if (row.submission_version !== args.submissionVersion) return null;
  return row.payload ?? null;
}

export async function generateInfonavitDocxFromPayload(
  payload: unknown,
  b1Type: InfonavitDocumentType,
): Promise<Uint8Array> {
  const snapshot = adaptB3SnapshotToB1(payload);
  return generateInfonavitDocx({ documentType: b1Type, snapshot });
}
