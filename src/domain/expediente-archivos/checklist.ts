import {
  DOCUMENTO_TIPOS,
  DOCUMENTO_CATALOGO,
  filterItemsPorOwnerRoleCatalogo,
  findRowPorTipoDocumento,
  listDocumentosCatalogoForStage,
  ordenarPorTipoDocumentoCatalogo,
  TIPO_DOCUMENTO_LABEL,
  type DocumentoOwnerRole,
  type DocumentoStageId,
  type ExpedienteArchivoResumen,
  type TipoDocumento,
  type TipoDocumentoCatalogo,
} from "./types";
import { MockExpedienteArchivosIndexedDbRepo } from "./mock-indexeddb.repo";

export type ChecklistDocumentoItem = {
  tipo_documento: TipoDocumentoCatalogo;
  label: string;
};

export type ChecklistDocumentos = {
  completos: boolean;
  faltantes: ChecklistDocumentoItem[];
  completosLista: ChecklistDocumentoItem[];
};

/**
 * Columna DOCUMENTACIÓN (dashboard asesor): mismo universo de obligatorios por etapa que el checklist,
 * pero prioriza `estatus_revision` por tipo (no solo el paquete de 4 tipos base).
 *
 * Tipos en `DOCUMENTOS_NO_BLOQUEANTES_PARA_COLUMNA_DOCUMENTACION` siguen en catálogo y en el resto del
 * sistema; solo dejan de condicionar Faltantes / Pendiente / Completos en esta columna (p. ej. NSS
 * no bloquea envío a mesa en el flujo real).
 */
export type EstadoDocumentacionColumnaAsesor =
  | "faltantes"
  | "pendiente_aprobacion"
  | "completos";

/** Excluidos solo para `deriveEstadoDocumentacionColumnaAsesor` (no altera catálogo ni otros checks). */
const DOCUMENTOS_NO_BLOQUEANTES_PARA_COLUMNA_DOCUMENTACION: readonly TipoDocumentoCatalogo[] = [
  "nss",
];

/**
 * Familias base `sistema` ↔ `cliente_*` para la columna DOCUMENTACIÓN.
 * - INE: `ine` o cualquiera de los INE del cliente.
 * - Estado de cuenta: `estado_cuenta` ↔ `cliente_estado_cuenta`.
 * - Domicilio: `direccion` ↔ `cliente_comprobante_domicilio`.
 * - NSS: no hay `cliente_nss` en catálogo; el tipo `nss` no entra al loop de la columna (no bloqueante).
 */
const GRUPO_DOCUMENTACION_INE = [
  "ine",
  "cliente_ine_frente",
  "cliente_ine_reverso",
] as const satisfies readonly TipoDocumentoCatalogo[];

const GRUPO_DOCUMENTACION_ESTADO_CUENTA = [
  "estado_cuenta",
  "cliente_estado_cuenta",
] as const satisfies readonly TipoDocumentoCatalogo[];

const GRUPO_DOCUMENTACION_DOMICILIO = [
  "direccion",
  "cliente_comprobante_domicilio",
] as const satisfies readonly TipoDocumentoCatalogo[];

const GRUPO_DOCUMENTACION_NSS = ["nss"] as const satisfies readonly TipoDocumentoCatalogo[];

function tiposGrupoDocumentacionColumna(tipo: TipoDocumentoCatalogo): readonly TipoDocumentoCatalogo[] {
  if (
    tipo === "ine" ||
    tipo === "cliente_ine_frente" ||
    tipo === "cliente_ine_reverso"
  ) {
    return GRUPO_DOCUMENTACION_INE;
  }
  if (tipo === "estado_cuenta" || tipo === "cliente_estado_cuenta") {
    return GRUPO_DOCUMENTACION_ESTADO_CUENTA;
  }
  if (tipo === "direccion" || tipo === "cliente_comprobante_domicilio") {
    return GRUPO_DOCUMENTACION_DOMICILIO;
  }
  if (tipo === "nss") {
    return GRUPO_DOCUMENTACION_NSS;
  }
  return [tipo];
}

/** Prioridad: validado → subido/resubido → rechazado → faltante (entre filas del mismo grupo). */
function estatusEfectivoGrupoDocumentacion(
  resumen: readonly ExpedienteArchivoResumen[],
  grupo: readonly TipoDocumentoCatalogo[],
): "faltante" | "subido" | "resubido" | "validado" | "rechazado" | undefined {
  const rows = grupo
    .map((t) => findRowPorTipoDocumento(resumen, t))
    .filter((r): r is ExpedienteArchivoResumen => r != null);

  if (rows.length === 0) return undefined;

  if (rows.some((r) => r.estatus_revision === "validado")) return "validado";
  if (rows.some((r) => r.estatus_revision === "subido" || r.estatus_revision === "resubido")) {
    return rows.some((r) => r.estatus_revision === "resubido") ? "resubido" : "subido";
  }
  if (rows.some((r) => r.estatus_revision === "rechazado")) return "rechazado";
  return "faltante";
}

export function deriveEstadoDocumentacionColumnaAsesor(
  resumen: readonly ExpedienteArchivoResumen[],
  etapaActual: number | null | undefined,
): EstadoDocumentacionColumnaAsesor {
  const etapaNum = Number(etapaActual);
  const etapa =
    etapaActual != null && Number.isFinite(etapaNum) && etapaNum > 0 ? etapaNum : 1;

  const requiredCatalog = listDocumentosCatalogoForStage({
    etapaId: etapa,
    soloObligatorios: true,
  });

  const requiredFiltrado = requiredCatalog.filter(
    (doc) =>
      !DOCUMENTOS_NO_BLOQUEANTES_PARA_COLUMNA_DOCUMENTACION.includes(
        doc.tipo as TipoDocumentoCatalogo,
      ),
  );

  let hayFaltante = false;
  let hayPendienteAprobacion = false;

  const gruposVistos = new Set<string>();

  for (const req of requiredFiltrado) {
    const tipo = req.tipo as TipoDocumentoCatalogo;
    const grupo = tiposGrupoDocumentacionColumna(tipo);
    const claveGrupo = grupo.join("\0");
    if (gruposVistos.has(claveGrupo)) continue;
    gruposVistos.add(claveGrupo);

    const e = estatusEfectivoGrupoDocumentacion(resumen, grupo);

    if (typeof window !== "undefined") {
      console.log("[diag documentacion grupo]", {
        tipo,
        grupo: [...grupo],
        estatusGrupo: e,
        filas: grupo.map((gt) => {
          const r = findRowPorTipoDocumento(resumen, gt);
          return {
            tipo_documento: gt,
            estatus_revision: r?.estatus_revision ?? "(sin fila en resumen)",
          };
        }),
      });
    }

    if (!e || e === "faltante" || e === "rechazado") {
      hayFaltante = true;
      continue;
    }
    if (e === "subido" || e === "resubido") {
      hayPendienteAprobacion = true;
      continue;
    }
    if (e === "validado") continue;

    hayFaltante = true;
  }

  if (typeof window !== "undefined") {
    console.log("[diag resultado final]", {
      hayFaltante,
      hayPendienteAprobacion,
    });
  }

  if (hayFaltante) return "faltantes";
  if (hayPendienteAprobacion) return "pendiente_aprobacion";
  return "completos";
}

/** Subconjunto del checklist por actor del catálogo (p. ej. solo `cliente`, excluye `sistema` y `asesor`). */
export function filterChecklistDocumentoItemsPorOwnerRole(
  items: readonly ChecklistDocumentoItem[],
  ownerRole: DocumentoOwnerRole,
): ChecklistDocumentoItem[] {
  return filterItemsPorOwnerRoleCatalogo(items, ownerRole);
}

/**
 * Lista de revisión documental del cliente: obligatorios del checklist (completos + faltantes)
 * más opcionales del catálogo que ya tienen archivo (no se listan si siguen sin subir).
 */
export function buildClienteItemsRevisionDocumental(params: {
  checklist: ChecklistDocumentos;
  resumen: readonly ExpedienteArchivoResumen[];
  etapaId: DocumentoStageId;
}): ChecklistDocumentoItem[] {
  const { checklist, resumen, etapaId } = params;
  const obligatorios = [
    ...filterChecklistDocumentoItemsPorOwnerRole(checklist.completosLista, "cliente"),
    ...filterChecklistDocumentoItemsPorOwnerRole(checklist.faltantes, "cliente"),
  ];

  const opcionalesSubidos: ChecklistDocumentoItem[] = [];
  for (const doc of listDocumentosCatalogoForStage({
    etapaId,
    ownerRole: "cliente",
    soloObligatorios: false,
  })) {
    if (doc.obligatorio !== "opcional") continue;
    const row = findRowPorTipoDocumento(resumen, doc.tipo);
    if (!row?.id || row.estatus_revision === "faltante") continue;
    opcionalesSubidos.push({ tipo_documento: doc.tipo, label: doc.label });
  }

  return ordenarPorTipoDocumentoCatalogo([...obligatorios, ...opcionalesSubidos]);
}

function isTipoDocumentoBase(value: string): value is TipoDocumento {
  return (DOCUMENTO_TIPOS as readonly string[]).includes(value);
}

function labelForTipoDocumentoBase(tipo: TipoDocumento): string {
  const fromCatalog =
    (DOCUMENTO_CATALOGO as readonly { tipo: string; label: string }[]).find(
      (d) => d.tipo === tipo,
    )?.label;
  return fromCatalog ?? TIPO_DOCUMENTO_LABEL[tipo] ?? tipo;
}

function filaCumpleObligatorio(
  row: { estatus_revision: string } | undefined,
  pendienteRevisionCuentaComoCompleto: boolean,
): boolean {
  if (!row) return false;
  const e = row.estatus_revision;
  if (e === "faltante" || e === "rechazado") return false;
  if (pendienteRevisionCuentaComoCompleto) {
    return e === "validado" || e === "subido" || e === "resubido";
  }
  return e === "validado";
}

export function deriveChecklistDocumentosFromResumen(params: {
  resumen: Array<{
    tipo_documento: TipoDocumentoCatalogo;
    estatus_revision: "faltante" | "subido" | "validado" | "rechazado" | "resubido";
  }>;
  etapaActual: number;
  /**
   * En el sistema actual los tipos base (`DOCUMENTO_TIPOS`) no distinguen por role.
   * Este filtro se incluye para evolucionar hacia un catálogo por actor sin romper hoy.
   */
  ownerRole?: DocumentoOwnerRole;
  /**
   * `true`: integración / envío asesor — archivo subido (`subido`/`resubido`) cuenta como presente.
   * `false` (default): avance mesa — solo `validado` cumple el requisito.
   */
  pendienteRevisionCuentaComoCompleto?: boolean;
}): ChecklistDocumentos {
  const { resumen, etapaActual, ownerRole, pendienteRevisionCuentaComoCompleto = false } =
    params;

  const requiredCatalog = listDocumentosCatalogoForStage({
    etapaId: etapaActual,
    ownerRole,
    soloObligatorios: true,
  });

  const byTipo = new Map<TipoDocumentoCatalogo, { estatus_revision: string }>();
  for (const row of resumen)
    byTipo.set(row.tipo_documento, { estatus_revision: row.estatus_revision });

  const faltantes: ChecklistDocumentoItem[] = [];
  const completosLista: ChecklistDocumentoItem[] = [];

  for (const req of requiredCatalog) {
    const tipo = req.tipo as TipoDocumentoCatalogo;
    const row = byTipo.get(tipo);
    const ok = filaCumpleObligatorio(row, pendienteRevisionCuentaComoCompleto);
    const label = (DOCUMENTO_CATALOGO as readonly { tipo: string; label: string }[]).find(
      (d) => d.tipo === tipo,
    )?.label ?? (isTipoDocumentoBase(tipo) ? labelForTipoDocumentoBase(tipo as TipoDocumento) : tipo);
    if (ok) completosLista.push({ tipo_documento: tipo, label });
    else faltantes.push({ tipo_documento: tipo, label });
  }

  return {
    completos: faltantes.length === 0,
    faltantes: ordenarPorTipoDocumentoCatalogo(faltantes),
    completosLista: ordenarPorTipoDocumentoCatalogo(completosLista),
  };
}

/**
 * Checklist de documentos requeridos (por etapa) basado en:
 * - `expediente-archivos` (IndexedDB)
 * - `DOCUMENTO_CATALOGO` (catálogo extendido)
 *
 * Incluye obligatorios de `sistema` y `cliente` en la etapa; los tipos `asesor_*` son
 * opcionales en catálogo y no entran con `soloObligatorios: true`.
 *
 * Para paneles “solo documentos del cliente”, usar `filterChecklistDocumentoItemsPorOwnerRole`.
 */
export async function getChecklistDocumentos(
  expedienteId: string,
  etapaActual: number,
  options?: {
    pendienteRevisionCuentaComoCompleto?: boolean;
  },
): Promise<ChecklistDocumentos> {
  const repo = new MockExpedienteArchivosIndexedDbRepo();
  const list = await repo.listByExpediente(expedienteId);
  return deriveChecklistDocumentosFromResumen({
    resumen: list.map((x) => ({
      tipo_documento: x.tipo_documento,
      estatus_revision: x.estatus_revision,
    })),
    etapaActual,
    pendienteRevisionCuentaComoCompleto: options?.pendienteRevisionCuentaComoCompleto,
  });
}

/**
 * Checklist permanente de documentación del cliente para paneles de expediente en mesa-control.
 * Se desacopla de la etapa operativa (9/10/11/12, etc.) usando etapa documental base = 2.
 */
export async function getChecklistDocumentosClientePermanente(
  expedienteId: string,
  options?: {
    pendienteRevisionCuentaComoCompleto?: boolean;
  },
): Promise<ChecklistDocumentos> {
  const ETAPA_DOCUMENTAL_CLIENTE_BASE = 2;
  const repo = new MockExpedienteArchivosIndexedDbRepo();
  const list = await repo.listByExpediente(expedienteId);
  return deriveChecklistDocumentosFromResumen({
    resumen: list.map((x) => ({
      tipo_documento: x.tipo_documento,
      estatus_revision: x.estatus_revision,
    })),
    etapaActual: ETAPA_DOCUMENTAL_CLIENTE_BASE,
    ownerRole: "cliente",
    pendienteRevisionCuentaComoCompleto: options?.pendienteRevisionCuentaComoCompleto,
  });
}

