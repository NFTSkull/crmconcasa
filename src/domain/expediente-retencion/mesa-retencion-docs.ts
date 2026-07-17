import {
  findRowPorTipoDocumento,
  type ExpedienteArchivoResumen,
  type ResumenEstatus,
} from "@/domain/expediente-archivos/types";
import { mesaPuedeAbrirArchivo } from "@/domain/expediente-archivos/mesa-archivo-acceso";
import type { ExpedienteArchivoListItem } from "@/domain/expediente-archivos/map-supabase-expediente-documentos";
import {
  listRetencionUploadsForOpcion,
  RETENCION_ETAPA_OPERATIVA_ID,
  type RetencionTipoDocumento,
} from "@/domain/expediente-archivos/retencion-acuse-aviso";
import type { RetencionOpcion } from "./types";

export type MesaRetencionDocView = Readonly<{
  tipo_documento: RetencionTipoDocumento;
  label: string;
  archivo: ExpedienteArchivoResumen | null;
  estatus_revision: ResumenEstatus;
  comentario_mesa: string | null;
  puedeAbrir: boolean;
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

function resolveRetencionArchivo(
  tipo: RetencionTipoDocumento,
  resumenCatalog: readonly ExpedienteArchivoResumen[],
  listaActiva: readonly ExpedienteArchivoListItem[],
): ExpedienteArchivoResumen | null {
  const fromLista = findRowPorTipoDocumento(listaActiva, tipo);
  if (fromLista) return listItemToResumen(fromLista);

  const fromCatalog = findRowPorTipoDocumento(resumenCatalog, tipo);
  if (fromCatalog && mesaPuedeAbrirArchivo(fromCatalog)) return fromCatalog;

  return null;
}

/** Sección Mesa retención: etapa 8 (envío) y 9+ (lectura / agendar firma). */
export function canShowMesaRetencionSupabaseSection(params: {
  etapaActual: number | null | undefined;
}): boolean {
  const etapa = params.etapaActual;
  return typeof etapa === "number" && etapa >= RETENCION_ETAPA_OPERATIVA_ID;
}

export function mesaRetencionDocEstatusLabel(estatus: ResumenEstatus | undefined): string {
  if (!estatus || estatus === "faltante") return "Faltante";
  if (estatus === "subido") return "Recibido";
  if (estatus === "resubido") return "Recibido (reenviado)";
  if (estatus === "validado") return "Recibido";
  return "Rechazado";
}

export function buildMesaRetencionDocViews(
  opcion: RetencionOpcion | null | undefined,
  resumenCatalog: readonly ExpedienteArchivoResumen[],
  listaActiva: readonly ExpedienteArchivoListItem[] = [],
): MesaRetencionDocView[] {
  return listRetencionUploadsForOpcion(opcion).map(({ tipo, label }) => {
    const archivo = resolveRetencionArchivo(tipo, resumenCatalog, listaActiva);
    const estatus = archivo?.estatus_revision ?? "faltante";
    return {
      tipo_documento: tipo,
      label,
      archivo,
      estatus_revision: estatus,
      comentario_mesa: archivo?.comentario_mesa ?? null,
      puedeAbrir: mesaPuedeAbrirArchivo(archivo),
    };
  });
}
