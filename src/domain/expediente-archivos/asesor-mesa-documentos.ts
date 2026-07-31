import {
  DOCUMENTO_CATALOGO_MAP,
  findRowPorTipoDocumento,
  type ExpedienteArchivoResumen,
  type TipoDocumentoCatalogo,
} from "./types";
import {
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  type IntegrationDocMesaUploadTipo,
} from "./integration-docs-completos";
import { mesaPuedeAbrirArchivo } from "./mesa-archivo-acceso";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";

/**
 * Documentos de cliente que Mesa carga y el asesor propietario puede ver/descargar
 * (complementarios de la sección Mesa). Sin notas internas ni tipos administrativos.
 */
export const ASESOR_MESA_DOCUMENTOS_COMPARTIBLES = [
  ...INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
] as const satisfies readonly IntegrationDocMesaUploadTipo[];

export type AsesorMesaDocumentoCompartibleTipo =
  (typeof ASESOR_MESA_DOCUMENTOS_COMPARTIBLES)[number];

export type AsesorMesaDocumentoView = Readonly<{
  tipo_documento: AsesorMesaDocumentoCompartibleTipo;
  label: string;
  archivo: ExpedienteArchivoResumen;
  version: number;
}>;

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

/**
 * Solo versiones activas/vigentes con archivo abrible.
 * No incluye faltantes (sin tarjeta vacía).
 */
export function buildAsesorMesaDocumentosViews(
  listaActiva: readonly ExpedienteArchivoListItem[],
  resumenCatalog: readonly ExpedienteArchivoResumen[] = [],
): AsesorMesaDocumentoView[] {
  const out: AsesorMesaDocumentoView[] = [];

  for (const tipo of ASESOR_MESA_DOCUMENTOS_COMPARTIBLES) {
    const fromLista = findRowPorTipoDocumento(listaActiva, tipo as TipoDocumentoCatalogo);
    let archivo: ExpedienteArchivoResumen | null = null;
    let version = 1;
    if (fromLista && mesaPuedeAbrirArchivo(fromLista)) {
      archivo = listItemToResumen(fromLista);
      version = fromLista.version >= 1 ? fromLista.version : 1;
    } else {
      const fromCatalog = findRowPorTipoDocumento(
        resumenCatalog,
        tipo as TipoDocumentoCatalogo,
      );
      if (fromCatalog && mesaPuedeAbrirArchivo(fromCatalog)) {
        archivo = fromCatalog;
      }
    }
    if (!archivo) continue;

    out.push({
      tipo_documento: tipo,
      label: DOCUMENTO_CATALOGO_MAP[tipo].label,
      archivo,
      version,
    });
  }

  return out;
}

export function shouldShowAsesorMesaDocumentosSection(
  views: readonly AsesorMesaDocumentoView[],
): boolean {
  return views.length > 0;
}

/** Labels amigables para UI (sin prefijo Mesa · cuando aplica). */
export function labelAsesorMesaDocumento(
  tipo: AsesorMesaDocumentoCompartibleTipo,
): string {
  if (tipo === "cliente_constancia_sat") return "Constancia de situación fiscal";
  if (tipo === "cliente_semanas_cotizadas") return "Semanas cotizadas";
  if (tipo === "cliente_acta_nacimiento") return "Acta de nacimiento";
  return DOCUMENTO_CATALOGO_MAP[tipo as TipoDocumentoCatalogo].label;
}
