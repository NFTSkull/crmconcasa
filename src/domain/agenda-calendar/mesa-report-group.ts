import { z } from "zod";

/** Clasificación exclusiva para Excel (P109). No altera booking_kind operativo. */
export const MESA_AGENDA_REPORT_GROUPS = [
  "biometricos_tramite_completo",
  "biometricos",
  "inscripcion",
  "firmas",
  "notificacion",
] as const;

export type MesaAgendaReportGroup = (typeof MESA_AGENDA_REPORT_GROUPS)[number];

export const mesaAgendaReportGroupSchema = z.enum(MESA_AGENDA_REPORT_GROUPS);

export const MESA_AGENDA_REPORT_GROUP_LABELS: Readonly<
  Record<MesaAgendaReportGroup, string>
> = {
  biometricos_tramite_completo: "BIOMÉTRICOS / TRÁMITE COMPLETO",
  biometricos: "BIOMÉTRICOS",
  inscripcion: "INSCRIPCIÓN",
  firmas: "FIRMAS",
  notificacion: "NOTIFICACIÓN",
};

/** Orden canónico de bloques en el Excel. */
export const MESA_AGENDA_REPORT_GROUP_ORDER: readonly MesaAgendaReportGroup[] = [
  "biometricos_tramite_completo",
  "biometricos",
  "inscripcion",
  "firmas",
  "notificacion",
];

export function isMesaAgendaReportGroup(
  value: string | null | undefined,
): value is MesaAgendaReportGroup {
  return (
    typeof value === "string" &&
    (MESA_AGENDA_REPORT_GROUPS as readonly string[]).includes(value)
  );
}

/** Fallback cuando `report_group` es null: deriva solo de `kind` operativo. */
export function fallbackReportGroupFromKind(
  kind: string | null | undefined,
): MesaAgendaReportGroup {
  if (kind === "firmas") return "firmas";
  if (kind === "notificacion") return "notificacion";
  return "biometricos";
}

export function resolveMesaAgendaReportGroup(input: {
  reportGroup?: string | null;
  kind: string;
}): MesaAgendaReportGroup {
  if (isMesaAgendaReportGroup(input.reportGroup)) {
    return input.reportGroup;
  }
  return fallbackReportGroupFromKind(input.kind);
}

export function mesaAgendaReportGroupLabel(
  group: MesaAgendaReportGroup,
): string {
  return MESA_AGENDA_REPORT_GROUP_LABELS[group];
}

export const MESA_AGENDA_REPORT_GROUP_OPTIONS: ReadonlyArray<{
  value: MesaAgendaReportGroup;
  label: string;
}> = MESA_AGENDA_REPORT_GROUP_ORDER.map((value) => ({
  value,
  label: MESA_AGENDA_REPORT_GROUP_LABELS[value],
}));

const REPORT_GROUP_RPC_MESSAGES: Readonly<Record<string, string>> = {
  MESA_REPORT_GROUP_UNAUTHORIZED:
    "No tienes permiso para cambiar la clasificación del Excel.",
  MESA_REPORT_GROUP_NOT_FOUND: "La cita no existe o ya no está disponible.",
  MESA_REPORT_GROUP_INVALID: "Selecciona una clasificación válida para el Excel.",
  MESA_REPORT_GROUP_CONFLICT:
    "La cita cambió mientras se guardaba. Recarga e intenta de nuevo.",
};

export type RpcErrorLike = Readonly<{
  code?: string;
  message?: string;
  details?: string;
}>;

export function getMesaReportGroupErrorCode(error: RpcErrorLike): string | null {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    Object.keys(REPORT_GROUP_RPC_MESSAGES).find((code) =>
      source.includes(code),
    ) ?? null
  );
}

export function mapMesaReportGroupRpcError(
  error: RpcErrorLike,
  fallback = "No se pudo guardar la clasificación para Excel.",
): Error {
  const code = getMesaReportGroupErrorCode(error);
  return new Error(
    code ? (REPORT_GROUP_RPC_MESSAGES[code] ?? fallback) : fallback,
  );
}

export const mesaSetReportGroupResponseSchema = z.object({
  ok: z.literal(true),
  booking_id: z.string().uuid(),
  report_group: mesaAgendaReportGroupSchema,
  report_group_anterior: z.string().nullable().optional(),
  kind: z.string().min(1),
});
