import {
  deriveIntegrationDocsChecklist,
  deriveIntegrationDocsChecklistOpcionalesSoloAsesor,
  integrationDocsResumenFromArchivoResumen,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocChecklistItem,
} from "./integration-docs-completos";
import { mesaPuedeAbrirArchivo } from "./mesa-archivo-acceso";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
import {
  findRowPorTipoDocumento,
  rowMasRecientePorTipoDocumento,
  type ExpedienteArchivoResumen,
  type TipoDocumentoCatalogo,
} from "./types";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO } from "./integration-docs-completos";

export type MesaIntegrationDocView = IntegrationDocChecklistItem & {
  archivo: ExpedienteArchivoResumen | null;
  comentario_mesa: string | null;
};

function listItemToResumen(item: ExpedienteArchivoListItem): ExpedienteArchivoResumen {
  return {
    expediente_id: item.expediente_id,
    tipo_documento: item.tipo_documento,
    id: item.id,
    nombre_original: item.nombre_original,
    mime_type: item.mime_type,
    size_bytes: item.size_bytes,
    created_at: item.created_at,
    uploaded_by_role: item.uploaded_by_role,
    uploaded_by_email: item.uploaded_by_email,
    estatus_revision: item.estatus_revision,
    comentario_mesa: item.comentario_mesa,
  };
}

/** Resuelve fila de archivo activa para un tipo de integración asesor (catálogo + lista real). */
export function resolveMesaArchivoPorTipo(
  tipo: IntegrationDocAsesorUploadTipo,
  resumenCatalog: readonly ExpedienteArchivoResumen[],
  listaActiva: readonly ExpedienteArchivoListItem[] = [],
): ExpedienteArchivoResumen | null {
  const fromLista = rowMasRecientePorTipoDocumento(
    listaActiva,
    tipo as TipoDocumentoCatalogo,
  );
  if (fromLista) {
    return listItemToResumen(fromLista);
  }

  const fromCatalog = findRowPorTipoDocumento(resumenCatalog, tipo as TipoDocumentoCatalogo);
  if (fromCatalog && mesaPuedeAbrirArchivo(fromCatalog)) {
    return fromCatalog;
  }

  return null;
}

/**
 * Checklist integración asesor para Mesa + metadata de archivo.
 * `tiposObligatorios` = contrato del dueño (RPC `asesor_documentos_obligatorios_envio`).
 * Default = 4 clásicos (compat tests / legacy callers).
 */
export function buildMesaIntegrationDocViews(
  resumenCatalog: readonly ExpedienteArchivoResumen[],
  listaActiva: readonly ExpedienteArchivoListItem[] = [],
  tiposObligatorios: readonly string[] = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
): MesaIntegrationDocView[] {
  const input = integrationDocsResumenFromArchivoResumen(resumenCatalog);
  const requiredSet = new Set(tiposObligatorios);
  const esContratoExterno =
    requiredSet.has("cliente_constancia_curp") &&
    !requiredSet.has("cliente_ine_reverso");
  const obligatorios = deriveIntegrationDocsChecklist(input, tiposObligatorios);
  const opcionales = deriveIntegrationDocsChecklistOpcionalesSoloAsesor(input).filter(
    (item) => !requiredSet.has(item.tipo_documento),
  );
  const checklist = [...obligatorios, ...opcionales];

  return checklist.map((item) => {
    const archivo = resolveMesaArchivoPorTipo(item.tipo_documento, resumenCatalog, listaActiva);
    return {
      ...item,
      label:
        esContratoExterno && item.tipo_documento === "cliente_ine_frente"
          ? "INE"
          : item.label,
      archivo,
      comentario_mesa: archivo?.comentario_mesa ?? null,
    };
  });
}

/** Scoped read-only Mesa solo si el tipo NO es obligatorio del dueño (evita duplicar checklist). */
export function shouldMountMesaScopedEquipoDocumentoSection(params: Readonly<{
  tipo: string;
  tiposObligatorios: readonly string[];
}>): boolean {
  return !params.tiposObligatorios.includes(params.tipo);
}
