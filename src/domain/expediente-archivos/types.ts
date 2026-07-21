export const DOCUMENTO_TIPOS = [
  "ine",
  "estado_cuenta",
  "nss",
  "direccion",
] as const;

export type TipoDocumento = (typeof DOCUMENTO_TIPOS)[number];

export type EstatusRevision = "subido" | "validado" | "rechazado" | "resubido";

export type ResumenEstatus = "faltante" | EstatusRevision;

/**
 * Catálogo extendido de tipos de documento del CRM.
 *
 * Importante: el sistema actual (UI + resumen + reglas) opera con un "paquete documental"
 * fijo (`DOCUMENTO_TIPOS`) de 4 tipos. Este catálogo NO cambia esa arquitectura; solo
 * define el universo completo para evolucionar `expediente-archivos` sin romper lo existente.
 */
export const TIPO_DOCUMENTO_CATALOGO = [
  // ===== Paquete documental actual (mesa/asesor) =====
  "ine",
  "estado_cuenta",
  "nss",
  "direccion",

  // ===== Documentos del cliente (catálogo) =====
  "cliente_ine_frente",
  "cliente_ine_reverso",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
  "cliente_acta_nacimiento",
  "cliente_constancia_sat",
  "cliente_semanas_cotizadas",
  "cliente_historial_laboral",
  "cliente_carta_empresa",
  "cliente_acta_nacimiento_digital",
  "cliente_pagare",
  "cliente_notificacion",

  // ===== Acuse / Aviso de retención (etapa operativa 8) =====
  "retencion_acuse_con_sello",
  "retencion_aviso_retencion",
  "retencion_ine_frente",
  "retencion_ine_reverso",
  "retencion_carta_sin_sello",

  // ===== Documentos del asesor (catálogo) =====
  "asesor_ine_frente",
  "asesor_ine_reverso",
  "asesor_estado_cuenta",
  "asesor_recibo_luz",
] as const;

export type TipoDocumentoCatalogo = (typeof TIPO_DOCUMENTO_CATALOGO)[number];

export type DocumentoOwnerRole = "cliente" | "asesor" | "sistema" | "mesa";

export type DocumentoObligatorio = "obligatorio" | "opcional";

export type DocumentoStageId = number;

export type DocumentoCatalogoItem = Readonly<{
  tipo: TipoDocumentoCatalogo;
  label: string;
  ownerRole: DocumentoOwnerRole;
  obligatorio: DocumentoObligatorio;
  /** Etapas operativas (ids) donde el documento se requiere. */
  etapasRequeridas: readonly DocumentoStageId[];
}>;

/**
 * Catálogo tipado y exhaustivo.
 *
 * Nota: al ser `Record<TipoDocumentoCatalogo, DocumentoCatalogoItem>`, TypeScript obliga
 * a declarar TODOS los tipos listados en `TIPO_DOCUMENTO_CATALOGO` y evita `undefined`
 * al acceder por clave.
 */
export const DOCUMENTO_CATALOGO_MAP = Object.freeze({
  // ===== Paquete documental actual (mesa/asesor) =====
  ine: {
    tipo: "ine",
    label: "INE (único)",
    ownerRole: "sistema",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  estado_cuenta: {
    tipo: "estado_cuenta",
    label: "Estado de cuenta",
    ownerRole: "sistema",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  nss: {
    tipo: "nss",
    label: "NSS",
    ownerRole: "sistema",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  direccion: {
    tipo: "direccion",
    label: "Comprobante de domicilio",
    ownerRole: "sistema",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },

  // ===== Documentos del cliente (catálogo) =====
  cliente_ine_frente: {
    tipo: "cliente_ine_frente",
    label: "Cliente · INE (frente)",
    ownerRole: "cliente",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  cliente_ine_reverso: {
    tipo: "cliente_ine_reverso",
    label: "Cliente · INE (reverso)",
    ownerRole: "cliente",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  cliente_comprobante_domicilio: {
    tipo: "cliente_comprobante_domicilio",
    label: "Cliente · Comprobante de domicilio",
    ownerRole: "cliente",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  cliente_estado_cuenta: {
    tipo: "cliente_estado_cuenta",
    label: "Cliente · Estado de cuenta",
    ownerRole: "cliente",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  cliente_acta_nacimiento: {
    tipo: "cliente_acta_nacimiento",
    label: "Mesa · Acta de nacimiento",
    ownerRole: "mesa",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  cliente_constancia_sat: {
    tipo: "cliente_constancia_sat",
    label: "Mesa · Constancia SAT",
    ownerRole: "mesa",
    obligatorio: "obligatorio",
    etapasRequeridas: [1, 2],
  },
  cliente_semanas_cotizadas: {
    tipo: "cliente_semanas_cotizadas",
    label: "Cliente · Semanas cotizadas",
    ownerRole: "cliente",
    obligatorio: "opcional",
    etapasRequeridas: [1, 2],
  },
  cliente_historial_laboral: {
    tipo: "cliente_historial_laboral",
    label: "Cliente · Historial laboral",
    ownerRole: "cliente",
    obligatorio: "opcional",
    etapasRequeridas: [],
  },
  cliente_carta_empresa: {
    tipo: "cliente_carta_empresa",
    label: "Cliente · Carta de la empresa",
    ownerRole: "cliente",
    obligatorio: "opcional",
    etapasRequeridas: [1, 2],
  },
  cliente_acta_nacimiento_digital: {
    tipo: "cliente_acta_nacimiento_digital",
    label: "Cliente · Acta de nacimiento digital",
    ownerRole: "cliente",
    obligatorio: "opcional",
    etapasRequeridas: [1, 2],
  },
  /** P090: Pagaré — Mesa escribe desde etapa 7; asesor solo lectura. No obligatorio / no gate. */
  cliente_pagare: {
    tipo: "cliente_pagare",
    label: "Pagaré",
    ownerRole: "mesa",
    obligatorio: "opcional",
    etapasRequeridas: [],
  },
  /**
   * P092: documento Notificación (`cliente_notificacion`) — Mesa desde etapa 7; asesor RO.
   * Distinto de agenda `kind=notificacion`. No obligatorio / no gate.
   */
  cliente_notificacion: {
    tipo: "cliente_notificacion",
    label: "Notificación",
    ownerRole: "mesa",
    obligatorio: "opcional",
    etapasRequeridas: [],
  },

  retencion_acuse_con_sello: {
    tipo: "retencion_acuse_con_sello",
    label: "Retención · Acuse / documento con sello",
    ownerRole: "cliente",
    obligatorio: "obligatorio",
    etapasRequeridas: [8],
  },
  retencion_aviso_retencion: {
    tipo: "retencion_aviso_retencion",
    label: "Retención · Aviso de retención",
    ownerRole: "cliente",
    obligatorio: "opcional",
    etapasRequeridas: [8],
  },
  retencion_ine_frente: {
    tipo: "retencion_ine_frente",
    label: "Retención · INE frente (Acuse/Aviso)",
    ownerRole: "cliente",
    obligatorio: "opcional",
    etapasRequeridas: [8],
  },
  retencion_ine_reverso: {
    tipo: "retencion_ine_reverso",
    label: "Retención · INE reverso (Acuse/Aviso)",
    ownerRole: "cliente",
    obligatorio: "opcional",
    etapasRequeridas: [8],
  },
  retencion_carta_sin_sello: {
    tipo: "retencion_carta_sin_sello",
    label: "Retención · Carta motivo sin sello",
    ownerRole: "cliente",
    obligatorio: "obligatorio",
    etapasRequeridas: [8],
  },

  // ===== Documentos del asesor (catálogo) =====
  asesor_ine_frente: {
    tipo: "asesor_ine_frente",
    label: "Asesor · INE (frente)",
    ownerRole: "asesor",
    obligatorio: "opcional",
    etapasRequeridas: [1],
  },
  asesor_ine_reverso: {
    tipo: "asesor_ine_reverso",
    label: "Asesor · INE (reverso)",
    ownerRole: "asesor",
    obligatorio: "opcional",
    etapasRequeridas: [1],
  },
  asesor_estado_cuenta: {
    tipo: "asesor_estado_cuenta",
    label: "Asesor · Estado de cuenta",
    ownerRole: "asesor",
    obligatorio: "opcional",
    etapasRequeridas: [1],
  },
  asesor_recibo_luz: {
    tipo: "asesor_recibo_luz",
    label: "Asesor · Recibo de luz",
    ownerRole: "asesor",
    obligatorio: "opcional",
    etapasRequeridas: [1],
  },
} satisfies Record<TipoDocumentoCatalogo, DocumentoCatalogoItem>);

export const DOCUMENTO_CATALOGO: readonly DocumentoCatalogoItem[] = Object.freeze(
  TIPO_DOCUMENTO_CATALOGO.map((t) => DOCUMENTO_CATALOGO_MAP[t]),
);

export function getDocumentoCatalogoItem(
  tipo: TipoDocumentoCatalogo,
): DocumentoCatalogoItem | null {
  return DOCUMENTO_CATALOGO_MAP[tipo] ?? null;
}

export function listDocumentosCatalogoForStage(params: {
  etapaId: DocumentoStageId;
  ownerRole?: DocumentoOwnerRole;
  soloObligatorios?: boolean;
}): DocumentoCatalogoItem[] {
  const { etapaId, ownerRole, soloObligatorios } = params;
  return (DOCUMENTO_CATALOGO as readonly DocumentoCatalogoItem[]).filter((d) => {
    if (!d.etapasRequeridas.includes(etapaId)) return false;
    if (ownerRole && d.ownerRole !== ownerRole) return false;
    if (soloObligatorios && d.obligatorio !== "obligatorio") return false;
    return true;
  });
}

/** Resumen derivado del paquete documental (4 tipos), independiente del rechazo operativo del trámite. */
export type CategoriaResumenDocumental =
  | "faltantes"
  | "pendiente_revision_documental"
  | "correccion_requerida"
  | "correccion_enviada"
  | "documentos_validados";

export interface ExpedienteArchivo {
  id: string;
  expediente_id: string;
  tipo_documento: TipoDocumentoCatalogo;
  nombre_original: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_role: string;
  uploaded_by_email: string;
  estatus_revision: EstatusRevision;
  comentario_mesa: string | null;
  /**
   * Blob real del archivo.
   * Nota: se usa solo en `getArchivoBlob` y/o en escritura; la UI normalmente trabaja con metadata.
   */
  blob: Blob;
}

export interface ExpedienteArchivoResumen {
  expediente_id: string;
  tipo_documento: TipoDocumentoCatalogo;
  id: string | null;
  nombre_original: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
  uploaded_by_role: string | null;
  uploaded_by_email: string | null;
  estatus_revision: ResumenEstatus;
  comentario_mesa: string | null;
}

/** tipo → índice en `TIPO_DOCUMENTO_CATALOGO` (orden canónico, no alfabético). */
export const MAP_INDICE_TIPO_DOCUMENTO_CATALOGO = new Map<
  TipoDocumentoCatalogo,
  number
>(TIPO_DOCUMENTO_CATALOGO.map((t, i) => [t, i]));

export function compareTipoDocumentoCatalogo(
  a: TipoDocumentoCatalogo,
  b: TipoDocumentoCatalogo,
): number {
  return MAP_INDICE_TIPO_DOCUMENTO_CATALOGO.get(a)! - MAP_INDICE_TIPO_DOCUMENTO_CATALOGO.get(b)!;
}

export function ordenarPorTipoDocumentoCatalogo<
  T extends { tipo_documento: TipoDocumentoCatalogo },
>(items: readonly T[]): T[] {
  return [...items].sort((x, y) =>
    compareTipoDocumentoCatalogo(x.tipo_documento, y.tipo_documento),
  );
}

export function isTipoPaqueteDocumental(t: TipoDocumentoCatalogo): t is TipoDocumento {
  for (const b of DOCUMENTO_TIPOS) {
    if (b === t) return true;
  }
  return false;
}

export function filterResumenPaqueteDocumental(
  resumen: readonly ExpedienteArchivoResumen[],
): ExpedienteArchivoResumen[] {
  return resumen.filter((r) => isTipoPaqueteDocumental(r.tipo_documento));
}

/** Filtra ítems cuyo `tipo_documento` tiene el `ownerRole` indicado en `DOCUMENTO_CATALOGO_MAP`. */
export function filterItemsPorOwnerRoleCatalogo<
  T extends { tipo_documento: TipoDocumentoCatalogo },
>(items: readonly T[], ownerRole: DocumentoOwnerRole): T[] {
  return items.filter(
    (it) => DOCUMENTO_CATALOGO_MAP[it.tipo_documento].ownerRole === ownerRole,
  );
}

export function filterResumenPorOwnerRole(
  resumen: readonly ExpedienteArchivoResumen[],
  ownerRole: DocumentoOwnerRole,
): ExpedienteArchivoResumen[] {
  return filterItemsPorOwnerRoleCatalogo(resumen, ownerRole);
}

function createdAtIsoToMillis(iso: string | null | undefined): number {
  if (iso == null || iso === "") return 0;
  const n = new Date(iso).getTime();
  return Number.isNaN(n) ? 0 : n;
}

/** Primera fila con el `tipo_documento` indicado (p. ej. una entrada por tipo en resumen de expediente). */
export function findRowPorTipoDocumento<
  T extends { tipo_documento: TipoDocumentoCatalogo },
>(rows: readonly T[], tipo: TipoDocumentoCatalogo): T | undefined {
  return rows.find((r) => r.tipo_documento === tipo);
}

/** Todas las filas con el mismo `tipo_documento`. */
export function rowsPorTipoDocumento<
  T extends { tipo_documento: TipoDocumentoCatalogo },
>(rows: readonly T[], tipo: TipoDocumentoCatalogo): T[] {
  return rows.filter((r) => r.tipo_documento === tipo);
}

/**
 * Entre filas con el mismo tipo, la de `created_at` más reciente (útil si hay más de un registro).
 */
export function rowMasRecientePorTipoDocumento<
  T extends { tipo_documento: TipoDocumentoCatalogo; created_at: string | null },
>(rows: readonly T[], tipo: TipoDocumentoCatalogo): T | undefined {
  return rowsPorTipoDocumento(rows, tipo).sort(
    (a, b) => createdAtIsoToMillis(b.created_at) - createdAtIsoToMillis(a.created_at),
  )[0];
}

/**
 * Prioridad: faltantes → rechazo documental → resubidos → pendiente de revisión → todo validado.
 */
export function deriveResumenDocumental(
  resumen: readonly ExpedienteArchivoResumen[],
): CategoriaResumenDocumental {
  const byTipo = new Map<TipoDocumentoCatalogo, ExpedienteArchivoResumen>();
  for (const row of resumen) {
    byTipo.set(row.tipo_documento, row);
  }

  for (const tipo of DOCUMENTO_TIPOS as readonly TipoDocumento[]) {
    const item = byTipo.get(tipo);
    if (!item || item.estatus_revision === "faltante") {
      return "faltantes";
    }
  }

  const estatuses = (DOCUMENTO_TIPOS as readonly TipoDocumento[]).map(
    (t) => byTipo.get(t)!.estatus_revision,
  );

  if (estatuses.some((s) => s === "rechazado")) return "correccion_requerida";
  if (estatuses.some((s) => s === "resubido")) return "correccion_enviada";
  if (estatuses.some((s) => s === "subido")) return "pendiente_revision_documental";
  if (estatuses.every((s) => s === "validado")) return "documentos_validados";

  return "pendiente_revision_documental";
}

export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumento, string> = {
  ine: "INE",
  estado_cuenta: "Estado de cuenta",
  nss: "NSS",
  direccion: "Dirección",
};

export function labelTipoDocumentoCatalogo(tipo: TipoDocumentoCatalogo): string {
  return DOCUMENTO_CATALOGO_MAP[tipo].label;
}

