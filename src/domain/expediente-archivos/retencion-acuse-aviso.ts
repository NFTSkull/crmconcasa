import {
  DOCUMENTO_CATALOGO_MAP,
  findRowPorTipoDocumento,
  type TipoDocumentoCatalogo,
} from "./types";
import type { RetencionOpcion } from "@/domain/expediente-retencion/types";

export const RETENCION_ETAPA_OPERATIVA_ID = 8;

export const RETENCION_TIPOS_DOCUMENTO = [
  "retencion_acuse_con_sello",
  "retencion_aviso_retencion",
  "retencion_ine_frente",
  "retencion_ine_reverso",
  "retencion_carta_sin_sello",
] as const satisfies readonly TipoDocumentoCatalogo[];

export type RetencionTipoDocumento = (typeof RETENCION_TIPOS_DOCUMENTO)[number];

export const RETENCION_DOC_LABEL: Record<RetencionTipoDocumento, string> = {
  retencion_acuse_con_sello: "Acuse / documento con sello",
  retencion_aviso_retencion: "Aviso de retención",
  retencion_ine_frente: "INE frente para Acuse/Aviso",
  retencion_ine_reverso: "INE reverso para Acuse/Aviso",
  retencion_carta_sin_sello: "Carta de motivo por falta de sello",
};

const TIPOS_OPCION_CON_SELLO = [
  "retencion_acuse_con_sello",
  "retencion_aviso_retencion",
  "retencion_ine_frente",
  "retencion_ine_reverso",
] as const satisfies readonly RetencionTipoDocumento[];

const TIPOS_OPCION_SIN_SELLO = [
  "retencion_carta_sin_sello",
  "retencion_aviso_retencion",
  "retencion_ine_frente",
  "retencion_ine_reverso",
] as const satisfies readonly RetencionTipoDocumento[];

export type RetencionFaltanteItem =
  | { kind: "opcion"; label: string }
  | { kind: "documento"; tipo_documento: RetencionTipoDocumento; label: string };

export function tiposRequeridosRetencion(
  opcion: RetencionOpcion | null | undefined,
): readonly RetencionTipoDocumento[] {
  if (opcion === "con_sello") return TIPOS_OPCION_CON_SELLO;
  if (opcion === "sin_sello") return TIPOS_OPCION_SIN_SELLO;
  return [];
}

type ArchivoRowMin = {
  tipo_documento: TipoDocumentoCatalogo;
  id?: string | null;
  estatus_revision?: string;
};

function filaTieneArchivo(row: ArchivoRowMin | undefined): boolean {
  if (!row?.id) return false;
  return row.estatus_revision !== "faltante";
}

/** Faltantes del punto Acuse / Aviso (etapa 8): opción no elegida o documentos de la opción activa. */
export function deriveRetencionAcuseAvisoFaltantes(params: {
  retencion_opcion: RetencionOpcion | null | undefined;
  archivos: readonly ArchivoRowMin[];
}): RetencionFaltanteItem[] {
  const { retencion_opcion, archivos } = params;
  if (!retencion_opcion) {
    return [{ kind: "opcion", label: "Seleccionar opción A o B (tiene sello / no tiene sello)" }];
  }

  const faltantes: RetencionFaltanteItem[] = [];
  for (const tipo of tiposRequeridosRetencion(retencion_opcion)) {
    const row = findRowPorTipoDocumento(archivos, tipo);
    if (!filaTieneArchivo(row)) {
      faltantes.push({
        kind: "documento",
        tipo_documento: tipo,
        label: RETENCION_DOC_LABEL[tipo],
      });
    }
  }
  return faltantes;
}

export function retencionAcuseAvisoCompleto(params: {
  retencion_opcion: RetencionOpcion | null | undefined;
  archivos: readonly ArchivoRowMin[];
}): boolean {
  return deriveRetencionAcuseAvisoFaltantes(params).length === 0;
}

/**
 * Mensajes de bloqueo para avance operativo 8 → 9 (Mesa: `handleAprobarYSiguiente`).
 * B0D3A: helper listo; integración en mesa-control en B0D3B.
 */
export function getBloqueosRetencionAvanceEtapa8(params: {
  retencion_opcion: RetencionOpcion | null | undefined;
  archivos: readonly ArchivoRowMin[];
}): string[] {
  return deriveRetencionAcuseAvisoFaltantes(params).map((f) =>
    f.kind === "opcion" ? f.label : `Falta documento: ${f.label}`,
  );
}

export function labelRetencionOpcion(opcion: RetencionOpcion): string {
  return opcion === "con_sello"
    ? "Opción A — Tiene sello"
    : "Opción B — No tiene sello";
}

export const MSG_BLOQUEO_RETENCION_SIN_OPCION =
  "Falta seleccionar opción de Acuse/Aviso.";

export const MSG_BLOQUEO_RETENCION_SIN_ENVIO_ASESOR =
  "Falta enviar Acuse/Aviso a Mesa Control desde asesor.";

/**
 * Bloqueo mesa 8→9: opción elegida + envío asesor (`expediente_retencion_envio_mesa_v1`)
 * + cada documento requerido en `validado`.
 */
export function getBloqueosRetencionAvanceEtapa8Mesa(params: {
  retencion_opcion: RetencionOpcion | null | undefined;
  archivos: readonly ArchivoRowMin[];
  retencion_enviado_a_mesa: boolean;
}): string[] {
  const { retencion_opcion, archivos, retencion_enviado_a_mesa } = params;
  if (!retencion_opcion) {
    return [MSG_BLOQUEO_RETENCION_SIN_OPCION];
  }

  const bloqueos: string[] = [];
  if (!retencion_enviado_a_mesa) {
    bloqueos.push(MSG_BLOQUEO_RETENCION_SIN_ENVIO_ASESOR);
  }

  for (const tipo of tiposRequeridosRetencion(retencion_opcion)) {
    const row = findRowPorTipoDocumento(archivos, tipo);
    const label = RETENCION_DOC_LABEL[tipo];
    if (!row?.id || row.estatus_revision === "faltante") {
      bloqueos.push(`Acuse / Aviso: falta documento — ${label}`);
      continue;
    }
    if (row.estatus_revision === "rechazado") {
      bloqueos.push(`Acuse / Aviso: documento rechazado — ${label}`);
      continue;
    }
    if (row.estatus_revision === "subido" || row.estatus_revision === "resubido") {
      bloqueos.push(`Acuse / Aviso: pendiente de validar — ${label}`);
      continue;
    }
    if (row.estatus_revision !== "validado") {
      bloqueos.push(`Acuse / Aviso: documento incompleto — ${label}`);
    }
  }
  return bloqueos;
}

export function retencionListoParaAvanceMesa(params: {
  retencion_opcion: RetencionOpcion | null | undefined;
  archivos: readonly ArchivoRowMin[];
  retencion_enviado_a_mesa: boolean;
}): boolean {
  return getBloqueosRetencionAvanceEtapa8Mesa(params).length === 0;
}

/** Uploads visibles en asesor según la opción elegida (la opción no elegida queda oculta). */
export function isRetencionTipoDocumento(
  tipo: TipoDocumentoCatalogo,
): tipo is RetencionTipoDocumento {
  return (RETENCION_TIPOS_DOCUMENTO as readonly string[]).includes(tipo);
}

export function listRetencionUploadsForOpcion(
  opcion: RetencionOpcion | null | undefined,
): readonly { tipo: RetencionTipoDocumento; label: string }[] {
  return tiposRequeridosRetencion(opcion).map((tipo) => ({
    tipo,
    label: RETENCION_DOC_LABEL[tipo],
  }));
}

export function assertRetencionCatalogo(): void {
  for (const tipo of RETENCION_TIPOS_DOCUMENTO) {
    const item = DOCUMENTO_CATALOGO_MAP[tipo];
    if (!item.etapasRequeridas.includes(RETENCION_ETAPA_OPERATIVA_ID)) {
      throw new Error(`Catálogo retención: ${tipo} debe incluir etapa ${RETENCION_ETAPA_OPERATIVA_ID}`);
    }
  }
}
