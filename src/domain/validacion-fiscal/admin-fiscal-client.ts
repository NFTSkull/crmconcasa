import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { AdminFiscalRevisionManualItem } from "@/domain/validacion-fiscal/admin-aprobar-envio-mesa";

async function bearerAccessToken(): Promise<string> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new Error("Supabase no configurado");
  }
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();
  const token = session?.access_token?.trim();
  if (!token) throw new Error("Sesión no disponible");
  return token;
}

export async function fetchAdminFiscalRevisionManual(): Promise<{
  items: AdminFiscalRevisionManualItem[];
  count: number;
}> {
  const token = await bearerAccessToken();
  const res = await fetch("/api/admin/fiscal-revision-manual", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; items?: AdminFiscalRevisionManualItem[]; count?: number; message?: string; code?: string }
    | null;
  if (!res.ok || !json?.ok) {
    throw new Error(json?.message || json?.code || `Error ${res.status}`);
  }
  return { items: json.items ?? [], count: json.count ?? 0 };
}

export async function postAdminFiscalAprobarEnvioMesa(input: {
  expedienteId: string;
  motivo: string;
}): Promise<unknown> {
  const token = await bearerAccessToken();
  const res = await fetch("/api/admin/fiscal-aprobar-envio-mesa", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: unknown; message?: string; code?: string }
    | null;
  if (!res.ok || !json?.ok) {
    throw new Error(json?.message || json?.code || `Error ${res.status}`);
  }
  return json.result ?? null;
}
