import {
  etapaActualParaOperativo,
  normalizeOrigenMesa,
  type EditorDecision,
  type ExpedienteMock,
  type OperativoSubestado,
} from "./mock.repo";
import { mapProgramaDbToUi } from "./map-programa";

/** Fila anidada de `editor_decisions` (1:1; Supabase puede devolver objeto o array). */
export type SupabaseEditorDecisionEmbed = Readonly<{
  decision?: string | null;
  monto_aprobado?: number | string | null;
  notas_revision?: string | null;
  aprobado_at?: string | null;
  monto_aprobado_al_aprobar?: number | string | null;
  no_cumple_at?: string | null;
}>;

/** Perfil asesor embebido vía FK `asesor_id`. */
export type SupabaseAsesorProfileEmbed = Readonly<{
  email?: string | null;
  full_name?: string | null;
}>;

export type SupabaseReingresoRechazoEmbed = Readonly<{
  etapa?: number | null;
  motivo?: string | null;
  comentario?: string | null;
  biometricos_condicion?: string | null;
  biometricos_razon?: string | null;
}>;

/** Fila de listado admin desde `expedientes` + joins. */
export type SupabaseExpedienteListRow = Readonly<{
  id: string;
  programa: string;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  direccion_opcional?: string | null;
  asesor_id: string;
  origen_mesa?: string | null;
  submitted_to_mesa?: boolean | null;
  fecha_envio_mesa?: string | null;
  etapa_actual?: number | null;
  subestado?: string | null;
  ciclo_estado?: string | null;
  motivo_rechazo?: string | null;
  comentario_rechazo?: string | null;
  fecha_cita?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  expediente_anterior_id?: string | null;
  reingreso_rechazo_id?: string | null;
  editor_decisions?: SupabaseEditorDecisionEmbed | SupabaseEditorDecisionEmbed[] | null;
  reingreso_rechazo?:
    | SupabaseReingresoRechazoEmbed
    | SupabaseReingresoRechazoEmbed[]
    | null;
  asesor?: SupabaseAsesorProfileEmbed | SupabaseAsesorProfileEmbed[] | null;
}>;

export { mapProgramaDbToUi } from "./map-programa";

/** Respuesta JSON de RPC `create_expediente`. */
export type CreateExpedienteRpcResponse = Readonly<{
  id?: string;
  organization_id?: string;
  asesor_id?: string;
  origen_mesa?: string | null;
  programa?: string;
  nss?: string;
  cliente_nombre?: string;
  telefono_cliente?: string;
  direccion_opcional?: string | null;
  etapa_actual?: number | null;
  subestado?: string | null;
  ciclo_estado?: string | null;
  submitted_to_mesa?: boolean | null;
  created_at?: string | null;
}>;

function normalizeEditorDecision(value: unknown): EditorDecision {
  if (value === "aprobado" || value === "no_cumple" || value === "pendiente") {
    return value;
  }
  return "pendiente";
}

function normalizeSubestado(value: unknown): OperativoSubestado {
  if (
    value === "pendiente" ||
    value === "en_validacion_mesa" ||
    value === "en_proceso" ||
    value === "aprobado" ||
    value === "rechazado"
  ) {
    return value;
  }
  return "pendiente";
}

function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function parseMontoAprobado(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
}

function isoOrNow(value: unknown): string {
  const iso = textOrNull(value);
  if (!iso) return new Date().toISOString();
  return iso;
}

function resolveAsesorId(
  row: SupabaseExpedienteListRow,
  asesorEmbed: SupabaseAsesorProfileEmbed | null,
): string {
  const email = asesorEmbed?.email?.trim();
  if (email) return email;
  return row.asesor_id?.trim() || "";
}

/** Mapea fila Supabase → `ExpedienteMock` para dashboards admin (read-only P3B.1). */
export function mapSupabaseRowToExpedienteMock(
  row: SupabaseExpedienteListRow,
  asesorProfileOverride?: SupabaseAsesorProfileEmbed | null,
): ExpedienteMock {
  const editor = unwrapEmbed(row.editor_decisions);
  const rechazo = unwrapEmbed(row.reingreso_rechazo);
  const asesor = unwrapEmbed(row.asesor) ?? asesorProfileOverride ?? null;
  const subestado = normalizeSubestado(row.subestado ?? "pendiente");
  const etapaPersistida =
    typeof row.etapa_actual === "number" ? row.etapa_actual : null;
  const submittedToMesa = Boolean(row.submitted_to_mesa);
  const origenMesa =
    normalizeOrigenMesa(row.origen_mesa) ??
    (submittedToMesa ? "interno" : null);

  return {
    id: row.id,
    base: {
      programa: mapProgramaDbToUi(row.programa ?? ""),
      nss: row.nss ?? "",
      cliente_nombre: row.cliente_nombre ?? "",
      telefono_cliente: row.telefono_cliente ?? "",
      direccion_opcional: row.direccion_opcional?.trim() ?? "",
      asesorId: resolveAsesorId(row, asesor),
      asesorNombre: textOrNull(asesor?.full_name),
      asesorEmail: textOrNull(asesor?.email),
      createdAt: isoOrNow(row.created_at),
      origenMesa,
    },
    editorDecision: {
      decision: normalizeEditorDecision(editor?.decision),
      monto_aprobado: parseMontoAprobado(editor?.monto_aprobado),
      notas_revision:
        typeof editor?.notas_revision === "string" ? editor.notas_revision : "",
      aprobadoAt: textOrNull(editor?.aprobado_at),
      montoAprobadoAlAprobar: parseMontoAprobado(editor?.monto_aprobado_al_aprobar),
      noCumpleAt: textOrNull(editor?.no_cumple_at),
    },
    operativo: {
      etapaActual: etapaActualParaOperativo(etapaPersistida, subestado),
      subestado,
      motivoRechazo: textOrNull(row.motivo_rechazo),
      comentarioRechazo: textOrNull(row.comentario_rechazo),
      fechaCita: textOrNull(row.fecha_cita),
      updatedAt: textOrNull(row.updated_at),
      submittedToMesa,
      fechaEnvioMesa: textOrNull(row.fecha_envio_mesa),
      cicloEstado: textOrNull(row.ciclo_estado),
    },
    reingreso:
      row.reingreso_rechazo_id || row.expediente_anterior_id
        ? {
            expedienteAnteriorId: textOrNull(row.expediente_anterior_id),
            rechazoId: textOrNull(row.reingreso_rechazo_id),
            rechazoEtapa:
              typeof rechazo?.etapa === "number" ? rechazo.etapa : null,
            rechazoMotivo: textOrNull(rechazo?.motivo),
            rechazoComentario: textOrNull(rechazo?.comentario),
            biometricosCondicion: textOrNull(
              rechazo?.biometricos_condicion,
            ),
            biometricosRazon: textOrNull(rechazo?.biometricos_razon),
          }
        : undefined,
  };
}

/** Mapea respuesta RPC `create_expediente` → `ExpedienteMock` (P3C). */
export function mapCreateExpedienteRpcToExpedienteMock(
  row: CreateExpedienteRpcResponse,
  asesorEmailFallback = "",
): ExpedienteMock {
  const subestado = normalizeSubestado(row.subestado ?? "pendiente");
  const etapaPersistida =
    typeof row.etapa_actual === "number" ? row.etapa_actual : 1;
  const submittedToMesa = Boolean(row.submitted_to_mesa);
  const origenMesa = normalizeOrigenMesa(row.origen_mesa);

  return {
    id: row.id ?? "",
    base: {
      programa: mapProgramaDbToUi(row.programa ?? ""),
      nss: row.nss ?? "",
      cliente_nombre: row.cliente_nombre ?? "",
      telefono_cliente: row.telefono_cliente ?? "",
      direccion_opcional: row.direccion_opcional?.trim() ?? "",
      asesorId: asesorEmailFallback.trim() || row.asesor_id?.trim() || "",
      createdAt: isoOrNow(row.created_at),
      origenMesa,
    },
    editorDecision: {
      decision: "pendiente",
      monto_aprobado: null,
      notas_revision: "",
    },
    operativo: {
      etapaActual: etapaActualParaOperativo(etapaPersistida, subestado),
      subestado,
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
      updatedAt: null,
      submittedToMesa,
      fechaEnvioMesa: null,
      cicloEstado: textOrNull(row.ciclo_estado),
    },
  };
}
