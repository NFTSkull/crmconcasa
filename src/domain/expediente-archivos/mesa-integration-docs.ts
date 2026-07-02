import {
  deriveIntegrationDocsChecklist,
  integrationDocsResumenFromArchivoResumen,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocChecklistItem,
} from "./integration-docs-completos";
import { mesaPuedeAbrirArchivo } from "./mesa-archivo-acceso";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
import {
  findRowPorTipoDocumento,
  type ExpedienteArchivoResumen,
  type TipoDocumentoCatalogo,
} from "./types";

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
  const fromLista = findRowPorTipoDocumento(listaActiva, tipo as TipoDocumentoCatalogo);
  if (fromLista) {
    return listItemToResumen(fromLista);
  }

  const fromCatalog = findRowPorTipoDocumento(resumenCatalog, tipo as TipoDocumentoCatalogo);
  if (fromCatalog && mesaPuedeAbrirArchivo(fromCatalog)) {
    return fromCatalog;
  }

  return null;
}

/** Checklist integración asesor (4 obligatorios) + metadata de archivo para Mesa. */
export function buildMesaIntegrationDocViews(
  resumenCatalog: readonly ExpedienteArchivoResumen[],
  listaActiva: readonly ExpedienteArchivoListItem[] = [],
): MesaIntegrationDocView[] {
  const input = integrationDocsResumenFromArchivoResumen(resumenCatalog);
  const checklist = deriveIntegrationDocsChecklist(input);

  return checklist.map((item) => {
    const archivo = resolveMesaArchivoPorTipo(item.tipo_documento, resumenCatalog, listaActiva);
    return {
      ...item,
      archivo,
      comentario_mesa: archivo?.comentario_mesa ?? null,
    };
  });
}
