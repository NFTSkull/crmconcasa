/**
 * Contratos Zod para RPCs de líder de equipo / create_for_any_advisor.
 */
import { z } from "zod";

export const ASESOR_LIDER_DEFAULT_PAGE_SIZE = 25;
export const ASESOR_LIDER_MAX_PAGE_SIZE = 100;

export const CAP_TEAM_DASHBOARD_READ = "team_dashboard_read";
export const CAP_CREATE_FOR_ANY_ADVISOR = "create_for_any_advisor";

const uuidSchema = z.string().uuid();

const numericFlexible = z.preprocess((v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().nullable());

const countFlexible = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().int().nonnegative());

export const asesorLiderTeamSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  leader_id: uuidSchema,
  organization_id: uuidSchema,
});

export const asesorLiderContextSchema = z.object({
  team_dashboard_read: z.boolean(),
  capabilities: z.array(z.string()),
  team: asesorLiderTeamSchema.nullable(),
});

export type AsesorLiderContextParsed = z.infer<typeof asesorLiderContextSchema>;

export const asesorLiderMemberSchema = z.object({
  id: uuidSchema,
  full_name: z.string(),
  email: z.string(),
  is_leader: z.boolean(),
  active: z.boolean(),
});

export const asesorLiderMembersResultSchema = z.object({
  members: z.array(asesorLiderMemberSchema),
});

export const asesorLiderEtapaBucketSchema = z.object({
  etapa: z.number().int().min(1).max(12),
  nombre: z.string(),
  count: countFlexible,
  monto: z.preprocess((v) => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    return v;
  }, z.number().nonnegative()),
});

export const asesorLiderDashboardSchema = z.object({
  activos: countFlexible,
  cerrados: countFlexible,
  total: countFlexible,
  monto_total_aprobado: z.preprocess((v) => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    return v;
  }, z.number().nonnegative()),
  by_etapa: z.array(asesorLiderEtapaBucketSchema),
  filters: z.object({
    asesor_id: uuidSchema.nullable(),
    fecha_desde: z.string().nullable(),
    fecha_hasta: z.string().nullable(),
  }),
});

export type AsesorLiderDashboardParsed = z.infer<
  typeof asesorLiderDashboardSchema
>;

export const asesorLiderExpedienteRowSchema = z.object({
  id: uuidSchema,
  cliente_nombre: z.string(),
  nss: z.string(),
  telefono_cliente: z.string().nullable().optional(),
  asesor_id: uuidSchema,
  asesor_nombre: z.string().nullable().optional(),
  etapa_actual: z.number().int().nullable().optional(),
  ciclo_estado: z.string().nullable().optional(),
  subestado: z.string().nullable().optional(),
  submitted_to_mesa: z.boolean(),
  monto_aprobado: numericFlexible.optional(),
  monto_aprobado_al_aprobar: numericFlexible.optional(),
  decision: z.string().nullable().optional(),
  created_at: z.string(),
  fecha_envio_mesa: z.string().nullable().optional(),
});

export const asesorLiderExpedientesPageSchema = z.object({
  items: z.array(asesorLiderExpedienteRowSchema),
  total_count: countFlexible,
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
  has_more: z.boolean(),
});

export type AsesorLiderExpedientesPageParsed = z.infer<
  typeof asesorLiderExpedientesPageSchema
>;

export const asesorActivoOrgSchema = z.object({
  id: uuidSchema,
  full_name: z.string(),
  email: z.string(),
});

export const listAsesoresActivosOrgResultSchema = z.object({
  asesores: z.array(asesorActivoOrgSchema),
});

export const asesorLiderListPageInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(ASESOR_LIDER_MAX_PAGE_SIZE)
    .default(ASESOR_LIDER_DEFAULT_PAGE_SIZE),
  buscar: z.string().nullable().optional(),
  asesor_id: uuidSchema.nullable().optional(),
  etapa_exacta: z.number().int().min(1).max(12).nullable().optional(),
  fecha_desde: z.string().nullable().optional(),
  fecha_hasta: z.string().nullable().optional(),
  ciclo: z.enum(["activo", "cerrado"]).nullable().optional(),
});

export type AsesorLiderListPageInput = z.infer<
  typeof asesorLiderListPageInputSchema
>;

/** ¿Mostrar dashboard líder? Requiere capability + equipo activo. */
export function isAsesorLiderDashboardMode(ctx: {
  team_dashboard_read: boolean;
  team: unknown;
}): boolean {
  return ctx.team_dashboard_read === true && ctx.team != null;
}

export function hasCapability(
  ctx: { capabilities: readonly string[] },
  cap: string,
): boolean {
  return ctx.capabilities.includes(cap);
}

export function normalizeAsesorLiderPageOptions(input: {
  page?: number;
  pageSize?: number;
}): { page: number; pageSize: number; from: number } {
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const pageSize = Math.min(
    ASESOR_LIDER_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(input.pageSize ?? ASESOR_LIDER_DEFAULT_PAGE_SIZE) || 1),
  );
  return { page, pageSize, from: (page - 1) * pageSize };
}

export function asesorLiderTotalPages(
  totalCount: number,
  pageSize: number,
): number {
  const size = Math.max(1, pageSize);
  const total = Math.max(0, totalCount);
  return Math.max(1, Math.ceil(total / size));
}

export function clampAsesorLiderPage(
  page: number,
  totalCount: number,
  pageSize: number,
): number {
  const pages = asesorLiderTotalPages(totalCount, pageSize);
  return Math.min(Math.max(1, Math.floor(page) || 1), pages);
}
