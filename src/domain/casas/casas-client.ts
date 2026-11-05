"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CasaEstado = "borrador" | "enviada" | "ofertada" | "rechazada";

export type CasaSolicitud = {
  id: string;
  organization_id: string;
  asesor_id: string;
  estado: CasaEstado;
  nombre_contacto: string | null;
  telefono_contacto: string | null;
  municipio: string | null;
  colonia: string | null;
  direccion: string | null;
  tipo_inmueble: string | null;
  situacion_inmueble: string | null;
  adeudo_tipo: string | null;
  adeudo_aproximado_mxn: number | null;
  precio_esperado_mxn: number | null;
  comentarios: string | null;
  oferta_mxn: number | null;
  motivo_rechazo: string | null;
  nota_admin: string | null;
  enviada_at: string | null;
  revisada_at: string | null;
  revisada_por: string | null;
  created_at: string;
  updated_at: string;
};

export type CasaFoto = {
  id: string;
  solicitud_id: string;
  storage_path: string;
  nombre_archivo: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type CasaEvento = {
  id: number;
  solicitud_id: string;
  accion: "envio" | "oferta" | "rechazo";
  actor_id: string;
  monto_mxn: number | null;
  nota: string | null;
  created_at: string;
};

export type CasaFotoConUrl = CasaFoto & { url: string | null };

export const CASA_CAMPO_DETALLE: ReadonlyArray<{ key: keyof CasaSolicitud; label: string; money?: boolean }> = [
  { key: "nombre_contacto", label: "Contacto / propietario" },
  { key: "telefono_contacto", label: "Teléfono" },
  { key: "tipo_inmueble", label: "Tipo de inmueble" },
  { key: "municipio", label: "Municipio" },
  { key: "colonia", label: "Colonia" },
  { key: "direccion", label: "Dirección" },
  { key: "situacion_inmueble", label: "Estado de la casa" },
  { key: "adeudo_tipo", label: "Tipo de adeudo" },
  { key: "adeudo_aproximado_mxn", label: "Adeudo aproximado", money: true },
  { key: "precio_esperado_mxn", label: "Precio esperado", money: true },
  { key: "comentarios", label: "Notas del asesor" },
];

export function casaEstadoLabel(estado: CasaEstado): string {
  return {
    borrador: "Borrador",
    enviada: "Pendiente de revisión",
    ofertada: "Oferta recibida",
    rechazada: "No aprobada",
  }[estado];
}

export function casaEstadoStyle(estado: CasaEstado): string {
  return {
    borrador: "bg-slate-100 text-slate-700 border-slate-200",
    enviada: "bg-amber-50 text-amber-800 border-amber-200",
    ofertada: "bg-emerald-50 text-emerald-800 border-emerald-200",
    rechazada: "bg-rose-50 text-rose-800 border-rose-200",
  }[estado];
}

export function pesos(value: number | null | undefined): string {
  return value == null
    ? "—"
    : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value));
}

export function fechaCasa(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Monterrey",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(ms);
}

export function casaTitulo(casa: CasaSolicitud): string {
  return [casa.tipo_inmueble || "Casa sin tipo", casa.colonia || casa.municipio].filter(Boolean).join(" · ");
}

export async function cargarFotosCasa(client: SupabaseClient, solicitudId: string): Promise<CasaFotoConUrl[]> {
  const { data, error } = await client.from("casas_fotos")
    .select("id,solicitud_id,storage_path,nombre_archivo,mime_type,size_bytes,created_at")
    .eq("solicitud_id",solicitudId).order("created_at",{ ascending: true });
  if (error) throw new Error(error.message);
  return Promise.all(((data ?? []) as CasaFoto[]).map(async (foto) => {
    const signed = await client.storage.from("casas-fotos").createSignedUrl(foto.storage_path, 60 * 15);
    return { ...foto, url: signed.error ? null : signed.data.signedUrl };
  }));
}
