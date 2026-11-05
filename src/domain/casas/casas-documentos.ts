"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoDocumentoCasa =
  | "escritura" | "estado_cuenta_infonavit" | "ine_titular"
  | "acta_nacimiento_titular" | "curp_titular" | "rfc_titular"
  | "acta_matrimonio" | "acta_divorcio"
  | "ine_conyuge" | "acta_nacimiento_conyuge" | "curp_conyuge" | "rfc_conyuge"
  | "predial" | "agua_drenaje" | "cfe" | "gas"
  | "factura_2014_calculo_impuesto";

export type CasaDocumento = {
  id: string;
  solicitud_id: string;
  tipo_documento: TipoDocumentoCasa;
  storage_path: string;
  nombre_archivo: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
};

export type CasaDocumentoConUrl = CasaDocumento & { url: string | null };

type DocumentoConfig = {
  id: TipoDocumentoCasa;
  label: string;
  prioridad?: boolean;
  nota?: string;
};

export const CASA_GRUPOS_DOCUMENTALES: readonly {
  id: "titular" | "conyuge" | "servicios" | "exencion";
  titulo: string;
  descripcion: string;
  items: readonly DocumentoConfig[];
}[] = [
  {
    id: "titular", titulo: "Titular", descripcion: "Identidad y situación legal de la propiedad",
    items: [
      { id: "ine_titular", label: "INE del titular", prioridad: true, nota: "Prioritaria para enviar la casa" },
      { id: "escritura", label: "Escritura", nota: "Opcional" },
      { id: "estado_cuenta_infonavit", label: "Estado de cuenta Infonavit", nota: "Opcional" },
      { id: "acta_nacimiento_titular", label: "Acta de nacimiento", nota: "Opcional" },
      { id: "curp_titular", label: "CURP", nota: "Opcional" },
      { id: "rfc_titular", label: "RFC", nota: "Opcional" },
      { id: "acta_matrimonio", label: "Acta de matrimonio", nota: "Si aplica" },
      { id: "acta_divorcio", label: "Acta de divorcio", nota: "Si aplica" },
    ],
  },
  {
    id: "conyuge", titulo: "Cónyuge", descripcion: "Documentación cuando interviene el cónyuge",
    items: [
      { id: "ine_conyuge", label: "INE del cónyuge", prioridad: true, nota: "Necesaria si marcaste que aplica" },
      { id: "acta_nacimiento_conyuge", label: "Acta de nacimiento", nota: "Opcional" },
      { id: "curp_conyuge", label: "CURP", nota: "Opcional" },
      { id: "rfc_conyuge", label: "RFC", nota: "Opcional" },
    ],
  },
  {
    id: "servicios", titulo: "Servicios", descripcion: "Recibos de servicios disponibles (todos opcionales)",
    items: [
      { id: "predial", label: "Predial", nota: "Opcional" },
      { id: "agua_drenaje", label: "Agua y Drenaje", nota: "Opcional" },
      { id: "cfe", label: "CFE / luz", nota: "Opcional" },
      { id: "gas", label: "Gas Natural / Mex", nota: "Opcional" },
    ],
  },
  {
    id: "exencion", titulo: "Exención de impuestos", descripcion: "Solo cuando corresponde",
    items: [
      { id: "factura_2014_calculo_impuesto", label: "Factura 2014 / Cálculo de impuestos", nota: "Si aplica" },
    ],
  },
];

export const TOTAL_TIPOS_DOCUMENTOS_CASA =
  CASA_GRUPOS_DOCUMENTALES.reduce((n, grupo) => n + grupo.items.length, 0);

export function nombreTipoDocumentoCasa(tipo: TipoDocumentoCasa): string {
  for (const grupo of CASA_GRUPOS_DOCUMENTALES) {
    const encontrado = grupo.items.find((item) => item.id === tipo);
    if (encontrado) return encontrado.label;
  }
  return tipo;
}

export async function cargarDocumentosCasa(
  client: SupabaseClient, solicitudId: string,
): Promise<CasaDocumentoConUrl[]> {
  const { data, error } = await client.from("casas_documentos")
    .select("id,solicitud_id,tipo_documento,storage_path,nombre_archivo,mime_type,size_bytes,uploaded_by,created_at")
    .eq("solicitud_id", solicitudId).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return Promise.all(((data ?? []) as CasaDocumento[]).map(async (documento) => {
    const signed = await client.storage.from("casas-documentos")
      .createSignedUrl(documento.storage_path, 15 * 60);
    return {
      ...documento,
      url: signed.error ? null : signed.data.signedUrl,
    };
  }));
}

export function documentosClavePresentes(items: readonly CasaDocumento[]): {
  ineTitular: boolean;
  ineConyuge: boolean;
} {
  return {
    ineTitular: items.some((item) => item.tipo_documento === "ine_titular"),
    ineConyuge: items.some((item) => item.tipo_documento === "ine_conyuge"),
  };
}
