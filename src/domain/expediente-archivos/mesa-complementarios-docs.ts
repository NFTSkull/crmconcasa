import {
  DOCUMENTO_CATALOGO_MAP,
  findRowPorTipoDocumento,
  type ExpedienteArchivoResumen,
  type ResumenEstatus,
  type TipoDocumentoCatalogo,
} from "./types";
import { INTEGRATION_DOC_TIPOS_MESA_UPLOAD, type IntegrationDocMesaUploadTipo } from "./integration-docs-completos";
import { mesaPuedeAbrirArchivo } from "./mesa-archivo-acceso";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
import { integrationDocsResumenFromArchivoResumen } from "./integration-docs-completos";

export type MesaComplementarioEtiqueta = "opcional" | "requerido_mesa";

export type MesaComplementarioDocView = {
  tipo_documento: IntegrationDocMesaUploadTipo;
  label: string;
  estatus_revision: ResumenEstatus;
  etiqueta: MesaComplementarioEtiqueta;
  archivo: ExpedienteArchivoResumen | null;
  comentario_mesa: string | null;
};

function etiquetaPorTipo(tipo: IntegrationDocMesaUploadTipo): MesaComplementarioEtiqueta {
  if (tipo === "cliente_semanas_cotizadas") return "opcional";
  return "requerido_mesa";
}

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

function resolveArchivoPorTipo(
  tipo: IntegrationDocMesaUploadTipo,
  resumenCatalog: readonly ExpedienteArchivoResumen[],
  listaActiva: readonly ExpedienteArchivoListItem[],
): ExpedienteArchivoResumen | null {
  const fromLista = findRowPorTipoDocumento(listaActiva, tipo as TipoDocumentoCatalogo);
  if (fromLista) return listItemToResumen(fromLista);

  const fromCatalog = findRowPorTipoDocumento(resumenCatalog, tipo as TipoDocumentoCatalogo);
  if (fromCatalog && mesaPuedeAbrirArchivo(fromCatalog)) return fromCatalog;

  return null;
}

/** Checklist documentos complementarios / Mesa de Control (3 tipos). */
export function buildMesaComplementariosDocViews(
  resumenCatalog: readonly ExpedienteArchivoResumen[],
  listaActiva: readonly ExpedienteArchivoListItem[] = [],
): MesaComplementarioDocView[] {
  const input = integrationDocsResumenFromArchivoResumen(resumenCatalog);
  const byTipo = new Map(input.map((r) => [r.tipo_documento, r.estatus_revision]));

  return INTEGRATION_DOC_TIPOS_MESA_UPLOAD.map((tipo) => {
    const archivo = resolveArchivoPorTipo(tipo, resumenCatalog, listaActiva);
    return {
      tipo_documento: tipo,
      label: DOCUMENTO_CATALOGO_MAP[tipo].label,
      estatus_revision: byTipo.get(tipo) ?? "faltante",
      etiqueta: etiquetaPorTipo(tipo),
      archivo,
      comentario_mesa: archivo?.comentario_mesa ?? null,
    };
  });
}

/** Semanas cotizadas no cuenta en obligatorios de envío asesor ni validación 7 docs. */
export function semanasCotizadasEsOpcionalMesa(): boolean {
  return true;
}
