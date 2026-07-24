/**
 * P130 — formatters / anchors para lote de cambios del asesor en Mesa.
 * TZ America/Monterrey. Anchors allowlist (sin persistir en BD).
 */

const TZ = "America/Monterrey";

export type MesaAsesorCambioStatus = "pendiente_revision" | "revisado" | "borrador";

export type MesaAsesorCambiosSummaryItem = Readonly<{
  expedienteId: string;
  batchId: string | null;
  status: MesaAsesorCambioStatus | null;
  submittedAt: string | null;
  changesCount: number;
  summary: readonly string[];
}>;

export type MesaAsesorCambioLote = Readonly<{
  id: string;
  status: MesaAsesorCambioStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  asesorNombre: string | null;
  changesCount: number;
}>;

export type MesaAsesorCambioTipo =
  | "campo_actualizado"
  | "documento_agregado"
  | "documento_reemplazado"
  | "documento_eliminado";

export type MesaAsesorCambio = Readonly<{
  id: string;
  changeKey: string;
  tipo: MesaAsesorCambioTipo | string;
  entidad: string | null;
  campo: string | null;
  documentKind: string | null;
  label: string;
  valorAnterior: unknown;
  valorNuevo: unknown;
  documentoAnteriorId: string | null;
  documentoNuevoId: string | null;
  createdAt: string | null;
}>;

export type MesaAsesorCambioAnchor = Readonly<{
  sectionId: string;
  fieldId?: string;
}>;

export type MesaAsesorCambioGrupo =
  | "documentos"
  | "datos_cliente"
  | "datos_operativos"
  | "notas"
  | "otros";

const DOC_SECTION = "mesa-documentos-asesor";
const DATOS_SECTION = "mesa-datos-generales";
const MONTO_MEJORAVIT_SECTION = "mesa-monto-mejoravit-actualizado";

/** Allowlist campo / document_kind → ancla de sección en detalle Mesa. */
const FIELD_ANCHORS: Readonly<Record<string, MesaAsesorCambioAnchor>> = {
  rfc: { sectionId: DATOS_SECTION, fieldId: "rfc" },
  telefono: { sectionId: DATOS_SECTION, fieldId: "telefono" },
  celular: { sectionId: DATOS_SECTION, fieldId: "telefono" },
  telefono_cliente: { sectionId: DATOS_SECTION, fieldId: "telefono" },
  nombreCliente: { sectionId: DATOS_SECTION, fieldId: "nombreCliente" },
  nombre_cliente: { sectionId: DATOS_SECTION, fieldId: "nombreCliente" },
  direccion: { sectionId: DATOS_SECTION, fieldId: "direccion" },
  direccion_opcional: { sectionId: DATOS_SECTION, fieldId: "direccion" },
  referencias: { sectionId: DATOS_SECTION, fieldId: "referencias" },
  notaMesa: { sectionId: DATOS_SECTION, fieldId: "notaMesa" },
  nota_mesa: { sectionId: DATOS_SECTION, fieldId: "notaMesa" },
  porcentaje_cobro: { sectionId: DATOS_SECTION, fieldId: "porcentaje_cobro" },
  porcentajeCobro: { sectionId: DATOS_SECTION, fieldId: "porcentaje_cobro" },
  metodo_pago: { sectionId: DATOS_SECTION, fieldId: "metodo_pago" },
  metodoPago: { sectionId: DATOS_SECTION, fieldId: "metodo_pago" },
  plazo: { sectionId: DATOS_SECTION, fieldId: "plazo" },
  montoAprobado: { sectionId: DATOS_SECTION, fieldId: "montoAprobado" },
  monto_aprobado: { sectionId: DATOS_SECTION, fieldId: "montoAprobado" },
  montoCalculado: { sectionId: DATOS_SECTION, fieldId: "montoCalculado" },
  monto_calculado: { sectionId: DATOS_SECTION, fieldId: "montoCalculado" },
  montoMejoravit: { sectionId: MONTO_MEJORAVIT_SECTION, fieldId: "montoMejoravit" },
  monto_mejoravit: { sectionId: MONTO_MEJORAVIT_SECTION, fieldId: "montoMejoravit" },
};

const CLIENTE_FIELD_KEYS = new Set([
  "rfc",
  "telefono",
  "celular",
  "telefono_cliente",
  "nombreCliente",
  "nombre_cliente",
  "direccion",
  "direccion_opcional",
  "referencias",
  "curp",
  "nss",
  "correo",
  "empresa",
  "beneficiario",
]);

const OPERATIVO_FIELD_KEYS = new Set([
  "porcentaje_cobro",
  "porcentajeCobro",
  "metodo_pago",
  "metodoPago",
  "plazo",
  "montoAprobado",
  "monto_aprobado",
  "montoCalculado",
  "monto_calculado",
  "montoMejoravit",
  "monto_mejoravit",
]);

const NOTA_FIELD_KEYS = new Set(["notaMesa", "nota_mesa"]);

export const MESA_ASESOR_CAMBIOS_HISTORICO_TITULO =
  "Corrección histórica sin detalle de cambios";

export const MESA_ASESOR_CAMBIOS_HISTORICO_TEXTO =
  "Esta corrección fue enviada antes de que comenzara el registro detallado. Abre el expediente para revisarlo manualmente.";

export function formatMesaAsesorCambiosBadge(
  count: number | null | undefined,
  hasLote: boolean,
): string {
  if (!hasLote) return MESA_ASESOR_CAMBIOS_HISTORICO_TITULO;
  const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, count) : 0;
  return `Cambios del asesor · ${n}`;
}

export function esCorreccionHistoricaSinDetalle(params: {
  resumenDocumental?: string | null;
  advisorChangeBatchId?: string | null;
}): boolean {
  return (
    params.resumenDocumental === "correccion_enviada" &&
    !params.advisorChangeBatchId
  );
}

export function formatMesaAsesorCambiosResumen(
  summary: readonly string[] | null | undefined,
): readonly string[] {
  const lines = (summary ?? [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length <= 2) return lines;
  const extra = lines.length - 2;
  return [lines[0]!, lines[1]!, `+${extra} cambios`];
}

export function formatMesaAsesorReenviadoAt(
  iso: string | null | undefined,
): string | null {
  if (!iso || !String(iso).trim()) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-MX", {
      timeZone: TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
}

export function formatMesaAsesorCambioStatusLabel(
  status: MesaAsesorCambioStatus | string | null | undefined,
): string {
  if (status === "revisado") return "Revisado";
  if (status === "pendiente_revision") return "Pendiente de revisión";
  if (status === "borrador") return "Borrador";
  return "—";
}

export function mesaAsesorCambioAnchor(
  change: Pick<MesaAsesorCambio, "campo" | "documentKind" | "tipo" | "entidad">,
): MesaAsesorCambioAnchor | null {
  const kind = String(change.documentKind ?? "").trim();
  if (kind) {
    return { sectionId: DOC_SECTION, fieldId: kind };
  }

  const tipo = String(change.tipo ?? "");
  if (tipo.startsWith("documento_")) {
    return { sectionId: DOC_SECTION };
  }

  const campo = String(change.campo ?? "").trim();
  if (campo && FIELD_ANCHORS[campo]) {
    return FIELD_ANCHORS[campo]!;
  }

  if (campo.startsWith("monto") || campo.startsWith("Monto")) {
    if (/mejoravit/i.test(campo)) {
      return { sectionId: MONTO_MEJORAVIT_SECTION, fieldId: campo };
    }
    return { sectionId: DATOS_SECTION, fieldId: campo };
  }

  const entidad = String(change.entidad ?? "").trim().toLowerCase();
  if (entidad === "documento" || entidad === "documentos") {
    return { sectionId: DOC_SECTION };
  }
  if (entidad === "cliente_datos" || entidad === "datos_cliente") {
    return { sectionId: DATOS_SECTION, fieldId: campo || undefined };
  }

  return null;
}

export function groupMesaAsesorCambio(
  change: Pick<MesaAsesorCambio, "campo" | "documentKind" | "tipo" | "entidad">,
): MesaAsesorCambioGrupo {
  const tipo = String(change.tipo ?? "");
  if (tipo.startsWith("documento_") || String(change.documentKind ?? "").trim()) {
    return "documentos";
  }
  const campo = String(change.campo ?? "").trim();
  if (NOTA_FIELD_KEYS.has(campo)) return "notas";
  if (OPERATIVO_FIELD_KEYS.has(campo) || campo.startsWith("monto")) {
    return "datos_operativos";
  }
  if (CLIENTE_FIELD_KEYS.has(campo)) return "datos_cliente";
  const entidad = String(change.entidad ?? "").trim().toLowerCase();
  if (entidad === "nota" || entidad === "notas") return "notas";
  if (entidad === "cobro" || entidad === "operativo") return "datos_operativos";
  if (entidad === "cliente_datos" || entidad === "cliente") return "datos_cliente";
  if (entidad === "documento" || entidad === "documentos") return "documentos";
  return "otros";
}

export const MESA_ASESOR_CAMBIO_GRUPO_LABELS: Readonly<
  Record<MesaAsesorCambioGrupo, string>
> = {
  documentos: "Documentos",
  datos_cliente: "Datos del cliente",
  datos_operativos: "Datos operativos/cobro",
  notas: "Notas",
  otros: "Otros",
};

export const MESA_ASESOR_CAMBIOS_PANEL_ID = "mesa-asesor-cambios";
export const MESA_ASESOR_CAMBIOS_FOCUS = "asesor-cambios";

export function formatMesaAsesorCambioValor(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    const t = value.trim();
    return t || "—";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

export function formatMesaAsesorCambioTipoLabel(tipo: string | null | undefined): string {
  switch (String(tipo ?? "")) {
    case "campo_actualizado":
      return "Campo actualizado";
    case "documento_agregado":
      return "Documento agregado";
    case "documento_reemplazado":
      return "Documento reemplazado";
    case "documento_eliminado":
      return "Documento eliminado";
    default:
      return String(tipo ?? "—").trim() || "—";
  }
}
