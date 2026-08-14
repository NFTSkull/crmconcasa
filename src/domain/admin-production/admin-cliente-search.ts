import { z } from "zod";
import { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";
import { mapProgramaDbToUi } from "@/domain/expedientes/map-programa";

export const ADMIN_CLIENTE_SEARCH_DEFAULT_LIMIT = 20;
export const ADMIN_CLIENTE_SEARCH_MAX_LIMIT = 50;
export const ADMIN_CLIENTE_SEARCH_NSS_DIGIT_MIN = 3;

const isoOrText = z.union([z.string(), z.null()]).optional();

const itemSchema = z.object({
  expediente_id: z.string().min(1),
  cliente_nombre: z.string().nullable().optional(),
  nss: z.string().nullable().optional(),
  asesor_id: z.string().nullable().optional(),
  asesor_nombre: z.string().nullable().optional(),
  asesor_email: z.string().nullable().optional(),
  programa: z.string().nullable().optional(),
  created_at: isoOrText,
  updated_at: isoOrText,
  ciclo_estado: z.string().nullable().optional(),
  submitted_to_mesa: z.boolean().nullable().optional(),
  fecha_envio_mesa: isoOrText,
  etapa_actual: z.union([z.number(), z.string(), z.null()]).optional(),
  subestado: z.string().nullable().optional(),
  editor_decision: z.string().nullable().optional(),
  monto_aprobado: z.union([z.number(), z.string(), z.null()]).optional(),
  aprobado_at: isoOrText,
  no_cumple_at: isoOrText,
  reprecalificacion_pendiente_id: z.string().nullable().optional(),
  precal_pending: z.boolean().nullable().optional(),
  programa_solicitado: z.string().nullable().optional(),
});

const payloadSchema = z.object({
  items: z.array(itemSchema).default([]),
  truncated: z.boolean().optional(),
  limit: z.number().optional(),
});

export type AdminClienteSearchItem = Readonly<{
  expedienteId: string;
  clienteNombre: string;
  nss: string;
  asesorId: string | null;
  asesorNombre: string | null;
  asesorEmail: string | null;
  programa: string;
  createdAt: string | null;
  updatedAt: string | null;
  cicloEstado: string;
  submittedToMesa: boolean;
  fechaEnvioMesa: string | null;
  etapaActual: number;
  subestado: string | null;
  editorDecision: string;
  montoAprobado: number | null;
  aprobadoAt: string | null;
  noCumpleAt: string | null;
  reprecalificacionPendienteId: string | null;
  precalPending: boolean;
  programaSolicitado: string | null;
}>;

export type AdminClienteSearchResult = Readonly<{
  items: readonly AdminClienteSearchItem[];
  truncated: boolean;
  limit: number;
}>;

export type AdminClienteSearchInput = Readonly<{
  buscar: string;
  asesorId?: string | null;
  limit?: number;
}>;

export const EMPTY_ADMIN_CLIENTE_SEARCH: AdminClienteSearchResult = {
  items: [],
  truncated: false,
  limit: ADMIN_CLIENTE_SEARCH_DEFAULT_LIMIT,
};

export function clampAdminClienteSearchLimit(raw: unknown): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.trunc(raw)
      : ADMIN_CLIENTE_SEARCH_DEFAULT_LIMIT;
  return Math.min(ADMIN_CLIENTE_SEARCH_MAX_LIMIT, Math.max(1, n));
}

export function isAdminClienteSearchQueryActive(buscar: string | null | undefined): boolean {
  return (buscar ?? "").trim() !== "";
}

export function shouldApplyAdminSearchResponse(seq: number, latestSeq: number): boolean {
  return seq === latestSeq;
}

export function extractNssDigits(raw: string): string {
  const compact = raw.replace(/[\s\-]/g, "");
  if (!/^[0-9]+$/.test(compact)) return "";
  return compact.replace(/[^0-9]/g, "");
}

export function matchesAdminClienteSearchQuery(
  qRaw: string,
  fields: {
    clienteNombre: string;
    nss?: string | null;
    asesorNombre?: string | null;
    asesorEmail?: string | null;
    programa?: string | null;
  },
): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return false;
  const digits = extractNssDigits(q);
  const nss = String(fields.nss ?? "");
  const nssDigits = extractNssDigits(nss);
  const programa = String(fields.programa ?? "").toLowerCase();
  return (
    fields.clienteNombre.toLowerCase().includes(q) ||
    String(fields.asesorNombre ?? "").toLowerCase().includes(q) ||
    String(fields.asesorEmail ?? "").toLowerCase().includes(q) ||
    programa.includes(q) ||
    nss.toLowerCase().includes(q) ||
    (digits.length >= ADMIN_CLIENTE_SEARCH_NSS_DIGIT_MIN &&
      nssDigits.includes(digits))
  );
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function etapaNum(v: unknown): number {
  const n = numOrNull(v);
  if (n != null && n >= 1) return Math.trunc(n);
  return 1;
}

function mapItem(raw: z.infer<typeof itemSchema>): AdminClienteSearchItem {
  const pendingId = raw.reprecalificacion_pendiente_id?.trim() || null;
  return {
    expedienteId: raw.expediente_id,
    clienteNombre: (raw.cliente_nombre ?? "").trim(),
    nss: (raw.nss ?? "").trim(),
    asesorId: raw.asesor_id?.trim() || null,
    asesorNombre: raw.asesor_nombre?.trim() || null,
    asesorEmail: raw.asesor_email?.trim() || null,
    programa: (raw.programa ?? "").trim(),
    createdAt: raw.created_at?.trim() || null,
    updatedAt: raw.updated_at?.trim() || null,
    cicloEstado: (raw.ciclo_estado ?? "activo").trim() || "activo",
    submittedToMesa: Boolean(raw.submitted_to_mesa),
    fechaEnvioMesa: raw.fecha_envio_mesa?.trim() || null,
    etapaActual: etapaNum(raw.etapa_actual),
    subestado: raw.subestado?.trim() || null,
    editorDecision: (raw.editor_decision ?? "pendiente").trim() || "pendiente",
    montoAprobado: numOrNull(raw.monto_aprobado),
    aprobadoAt: raw.aprobado_at?.trim() || null,
    noCumpleAt: raw.no_cumple_at?.trim() || null,
    reprecalificacionPendienteId: pendingId,
    precalPending: pendingId != null || Boolean(raw.precal_pending),
    programaSolicitado: raw.programa_solicitado?.trim() || null,
  };
}

export function parseAdminClienteSearchPayload(raw: unknown): AdminClienteSearchResult {
  const parsed = payloadSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error("Respuesta de búsqueda Admin inválida");
  }
  const limit = clampAdminClienteSearchLimit(parsed.data.limit);
  const items = parsed.data.items.map(mapItem);
  return {
    items,
    truncated: Boolean(parsed.data.truncated),
    limit,
  };
}

export function labelAdminSearchPrecalDecision(decision: string): string {
  switch (decision) {
    case "aprobado":
      return "Aprobada";
    case "no_cumple":
      return "No cumple";
    case "pendiente":
      return "Pendiente de precalificación";
    default:
      return decision;
  }
}

export function labelAdminSearchCiclo(ciclo: string): string {
  switch (ciclo) {
    case "activo":
      return "Activo";
    case "cancelado":
      return "Cancelado";
    default:
      return ciclo;
  }
}

export function labelAdminSearchEtapa(etapaActual: number): string {
  return `Etapa ${etapaActual} · ${getEtapaOperativaNombre(etapaActual)}`;
}

export function labelAdminSearchPrograma(programa: string): string {
  return mapProgramaDbToUi(programa);
}

export function labelAdminSearchMesa(item: Pick<AdminClienteSearchItem, "submittedToMesa">): string {
  return item.submittedToMesa ? "Enviado a Mesa" : "No enviado a Mesa";
}

export function adminSearchProgramaSolicitadoVisible(
  vigente: string,
  solicitado: string | null,
): string | null {
  if (!solicitado) return null;
  if (solicitado === vigente) return null;
  return solicitado;
}

export function formatAdminSearchCoincidencias(count: number): string {
  return `${count} coincidencia${count === 1 ? "" : "s"}`;
}
