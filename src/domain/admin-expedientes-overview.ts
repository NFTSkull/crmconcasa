import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export type AdminMesaStatusFilter = "todos" | "enviados" | "no_enviados";
export type AdminExpedienteEstadoFilter =
  | "todos"
  | "activos"
  | "finalizados"
  | "rechazados"
  | "cancelados";

export type AdminExpedienteOverviewRow = Readonly<{
  expedienteId: string;
  clienteNombre: string;
  nss: string;
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  programa: string;
  etapaActual: number;
  subestado: string;
  cicloEstado: string;
  enviadoAMesa: boolean;
  fechaEnvioMesa: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  documentosActivosCount: number;
  documentosTotalCount: number;
  ultimoDocumentoAt: string | null;
}>;

export type AdminExpedienteOverviewPage = Readonly<{
  items: readonly AdminExpedienteOverviewRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}>;

export type AdminExpedienteAsesorOption = Readonly<{
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
}>;

export type AdminExpedientesOverviewInput = Readonly<{
  page?: number;
  pageSize?: number;
  asesorId?: string | null;
  etapaActual?: number | null;
  estado?: AdminExpedienteEstadoFilter;
  buscar?: string | null;
  mesaStatus?: AdminMesaStatusFilter;
}>;

function requireClient() {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new Error("Supabase no configurado");
  }
  return supabaseBrowser;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function strOrNull(v: unknown): string | null {
  const s = str(v).trim();
  return s || null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function mapAdminExpedienteOverviewRow(
  raw: Record<string, unknown>,
): AdminExpedienteOverviewRow {
  return {
    expedienteId: str(raw.expediente_id),
    clienteNombre: str(raw.cliente_nombre),
    nss: str(raw.nss),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    programa: str(raw.programa),
    etapaActual: num(raw.etapa_actual) || 1,
    subestado: str(raw.subestado),
    cicloEstado: str(raw.ciclo_estado),
    enviadoAMesa: Boolean(raw.enviado_a_mesa),
    fechaEnvioMesa: strOrNull(raw.fecha_envio_mesa),
    createdAt: strOrNull(raw.created_at),
    updatedAt: strOrNull(raw.updated_at),
    documentosActivosCount: num(raw.documentos_activos_count),
    documentosTotalCount: num(raw.documentos_total_count),
    ultimoDocumentoAt: strOrNull(raw.ultimo_documento_at),
  };
}

export async function fetchAdminExpedientesOverviewPage(
  input: AdminExpedientesOverviewInput,
): Promise<AdminExpedienteOverviewPage> {
  const client = requireClient();
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 25)));
  const estado = input.estado ?? "todos";
  const { data, error } = await client.rpc("admin_list_expedientes_overview_page", {
    p_page: page,
    p_page_size: pageSize,
    p_asesor_id: input.asesorId?.trim() || null,
    p_etapa_actual: input.etapaActual ?? null,
    p_estado: estado === "todos" ? null : estado,
    p_buscar: input.buscar?.trim() || null,
    p_mesa_status: input.mesaStatus ?? "todos",
  });

  if (error) {
    throw new Error(error.message || "No se pudieron cargar los expedientes.");
  }

  const root =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const itemsRaw = Array.isArray(root.items) ? root.items : [];

  return {
    items: itemsRaw.map((item) =>
      mapAdminExpedienteOverviewRow(
        item && typeof item === "object" ? (item as Record<string, unknown>) : {},
      ),
    ),
    totalCount: num(root.total_count),
    page: num(root.page) || page,
    pageSize: num(root.page_size) || pageSize,
  };
}

export async function fetchAdminExpedientesOverviewAsesores(): Promise<
  readonly AdminExpedienteAsesorOption[]
> {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_list_expedientes_overview_asesores");
  if (error) {
    throw new Error(error.message || "No se pudieron cargar los asesores.");
  }
  const root =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const items = Array.isArray(root.items) ? root.items : [];
  return items
    .map((item) => {
      const row =
        item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        asesorId: str(row.asesor_id),
        asesorNombre: strOrNull(row.asesor_nombre),
        asesorEmail: strOrNull(row.asesor_email),
      } satisfies AdminExpedienteAsesorOption;
    })
    .filter((row) => row.asesorId !== "");
}
