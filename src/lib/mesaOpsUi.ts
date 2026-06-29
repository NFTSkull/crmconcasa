import type { MesaExpedienteEstado, MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import { sortMesaBandejaPorAntiguedad, type MesaBandejaOrdenItem } from "@/lib/mesaBandejaOrden";

export type MesaOpsFilter = "todo_mesa" | "sin_asignar" | "mi_bandeja" | "en_trabajo";

/** Filtro operativo al cargar `/mesa-control`: expedientes libres para tomar. */
export const DEFAULT_MESA_OPS_FILTER: MesaOpsFilter = "sin_asignar";

export const MESA_OPS_FILTER_CHIPS: ReadonlyArray<{
  id: MesaOpsFilter;
  label: string;
}> = [
  { id: "sin_asignar", label: "Disponibles" },
  { id: "mi_bandeja", label: "Mi bandeja" },
  { id: "en_trabajo", label: "En trabajo" },
  { id: "todo_mesa", label: "Todo Mesa" },
];

export const MESA_OPS_FILTER_HELP_TEXT =
  "Disponibles: expedientes libres para tomar. Todo Mesa muestra la vista completa.";

export type MesaOpsStatusKind =
  | "sin_asignar"
  | "trabajando_por_ti"
  | "trabajando_por_otro"
  | "estado_especial";

const ESTADO_MESA_LABELS: Readonly<Record<MesaExpedienteEstado, string>> = {
  sin_asignar: "Sin asignar",
  trabajando: "Trabajando",
  en_espera_asesor: "En espera asesor",
  en_espera_cliente: "En espera cliente",
  en_espera_reagenda: "En espera reagenda",
  bloqueado: "Bloqueado",
  listo_para_avanzar: "Listo para avanzar",
  completado: "Completado",
};

const ADMIN_RELEASE_ROLES = new Set([
  "mesa_admin",
  "mesa_control_admin",
  "super_admin",
]);

const ADMIN_RELEASE_APP_ROLES = new Set(["mesa_admin", "super_admin"]);

export function isSinAsignarOps(ops: MesaExpedienteOpsRow | null | undefined): boolean {
  if (!ops) return true;
  return ops.estadoMesa === "sin_asignar" && !ops.assignedTo;
}

export function isAssignedToCurrentUser(
  ops: MesaExpedienteOpsRow | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  if (!ops?.assignedTo || !currentUserId) return false;
  return ops.assignedTo === currentUserId;
}

export function canMesaAdminReleaseOps(profileRole: string | null | undefined): boolean {
  const role = String(profileRole ?? "").trim();
  return ADMIN_RELEASE_ROLES.has(role);
}

/**
 * Prioridad: `profiles.app_role` (producción) → `sessionRole` (`super_admin`) → mock/dev.
 */
export function resolveMesaOpsAdminCanRelease(params: {
  appRole?: string | null;
  sessionRole?: string | null;
  mockRole?: string | null;
}): boolean {
  const app = String(params.appRole ?? "").trim();
  if (ADMIN_RELEASE_APP_ROLES.has(app)) return true;

  const session = String(params.sessionRole ?? "").trim();
  if (session === "super_admin") return true;

  const mock = String(params.mockRole ?? "").trim();
  if (mock && canMesaAdminReleaseOps(mock)) return true;

  return false;
}

export function getMesaOpsStatusKind(
  ops: MesaExpedienteOpsRow | null | undefined,
  currentUserId: string | null | undefined,
): MesaOpsStatusKind {
  if (isSinAsignarOps(ops)) return "sin_asignar";
  if (isAssignedToCurrentUser(ops, currentUserId)) return "trabajando_por_ti";
  if (ops?.assignedTo) return "trabajando_por_otro";
  if (ops && ops.estadoMesa !== "sin_asignar" && ops.estadoMesa !== "trabajando") {
    return "estado_especial";
  }
  return "sin_asignar";
}

export function getMesaOpsStatusLabel(
  ops: MesaExpedienteOpsRow | null | undefined,
  currentUserId: string | null | undefined,
): string {
  if (isSinAsignarOps(ops)) return "Sin asignar";
  if (isAssignedToCurrentUser(ops, currentUserId)) return "Trabajando por ti";
  if (ops?.assignedTo) {
    const name = ops.assignedToName?.trim();
    return name ? `Trabajando por ${name}` : "Trabajando por otro usuario";
  }
  if (ops?.estadoMesa && ops.estadoMesa !== "trabajando") {
    return ESTADO_MESA_LABELS[ops.estadoMesa] ?? ops.estadoMesa;
  }
  return "Sin asignar";
}

export function mesaOpsStatusBadgeClass(kind: MesaOpsStatusKind): string {
  switch (kind) {
    case "sin_asignar":
      return "inline-flex rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700";
    case "trabajando_por_ti":
      return "inline-flex rounded-md border border-emerald-400/80 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-950";
    case "trabajando_por_otro":
      return "inline-flex rounded-md border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-950";
    case "estado_especial":
      return "inline-flex rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950";
    default:
      return "inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600";
  }
}

export function buildMesaOpsMap(
  rows: readonly MesaExpedienteOpsRow[],
): ReadonlyMap<string, MesaExpedienteOpsRow> {
  const map = new Map<string, MesaExpedienteOpsRow>();
  for (const row of rows) {
    map.set(row.expedienteId, row);
  }
  return map;
}

export type MesaOpsFilterableItem = MesaBandejaOrdenItem &
  Readonly<{
    id: string;
    mesaOps?: MesaExpedienteOpsRow | null;
  }>;

export function filterMesaOpsItems<T extends MesaOpsFilterableItem>(
  items: readonly T[],
  filter: MesaOpsFilter,
  currentUserId: string | null | undefined,
): T[] {
  if (filter === "todo_mesa") return [...items];

  if (filter === "sin_asignar") {
    return items.filter((item) => isSinAsignarOps(item.mesaOps));
  }

  if (filter === "mi_bandeja") {
    return items.filter((item) => isAssignedToCurrentUser(item.mesaOps, currentUserId));
  }

  if (filter === "en_trabajo") {
    return items.filter((item) => Boolean(item.mesaOps?.assignedTo));
  }

  return [...items];
}

export function mergeExpedientesWithMesaOps<T extends MesaOpsFilterableItem>(
  items: readonly T[],
  opsMap: ReadonlyMap<string, MesaExpedienteOpsRow>,
): T[] {
  return items.map((item) => ({
    ...item,
    mesaOps: opsMap.get(item.id) ?? null,
  }));
}

/** Aplica filtro operativo y conserva orden por antigüedad en Mesa. */
export function applyMesaOpsFilterSorted<T extends MesaOpsFilterableItem>(
  items: readonly T[],
  filter: MesaOpsFilter,
  currentUserId: string | null | undefined,
): T[] {
  return sortMesaBandejaPorAntiguedad(filterMesaOpsItems(items, filter, currentUserId));
}

export function mapTakeResultToOpsRow(
  result: Readonly<{
    expedienteId: string;
    estadoMesa: MesaExpedienteEstado;
    assignedTo: string | null;
    assignedAt: string | null;
  }>,
  assignedToName: string | null,
  previous?: MesaExpedienteOpsRow | null,
): MesaExpedienteOpsRow {
  return {
    expedienteId: result.expedienteId,
    estadoMesa: result.estadoMesa,
    assignedTo: result.assignedTo,
    assignedAt: result.assignedAt,
    lastActivityAt: result.assignedAt ?? previous?.lastActivityAt ?? null,
    assignedToName,
  };
}

export function mapReleaseResultToOpsRow(
  result: Readonly<{ expedienteId: string; estadoMesa: MesaExpedienteEstado }>,
): MesaExpedienteOpsRow {
  return {
    expedienteId: result.expedienteId,
    estadoMesa: result.estadoMesa,
    assignedTo: null,
    assignedAt: null,
    lastActivityAt: new Date().toISOString(),
    assignedToName: null,
  };
}

export const MESA_OPS_TAKE_SUCCESS_MESSAGE =
  "Expediente tomado. Ahora aparece en tu bandeja.";

export const MESA_OPS_RELEASE_SUCCESS_MESSAGE =
  "Expediente liberado. Volvió a la bandeja general.";

export function mesaOpsTakePromptStorageKey(expedienteId: string): string {
  return `mesa_ops_take_prompt_dismissed_${expedienteId}`;
}
