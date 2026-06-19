"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { ExpedientesRepo } from "./repo";
import type { CreateExpedienteInput } from "./create-expediente.input";
import type { ExpedienteMock } from "./mock.repo";
import { mapProgramaUiToDb } from "./map-programa";
import {
  mapCreateExpedienteRpcToExpedienteMock,
  mapSupabaseRowToExpedienteMock,
  type CreateExpedienteRpcResponse,
  type SupabaseExpedienteListRow,
} from "./map-supabase-row";

const EXPEDIENTES_LIST_SELECT = `
  id,
  programa,
  nss,
  cliente_nombre,
  telefono_cliente,
  direccion_opcional,
  asesor_id,
  origen_mesa,
  submitted_to_mesa,
  fecha_envio_mesa,
  etapa_actual,
  subestado,
  motivo_rechazo,
  comentario_rechazo,
  fecha_cita,
  created_at,
  updated_at,
  editor_decisions ( decision, monto_aprobado, notas_revision ),
  asesor:profiles!expedientes_asesor_id_fkey ( email, full_name )
`;

export class ExpedientesSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpedientesSupabaseError";
  }
}

function mapCreateExpedienteRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedientesSupabaseError {
  const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (
    error.code === "23505" ||
    msg.includes("mismo nss y programa") ||
    msg.includes("expedientes_nss_programa_activo_unique")
  ) {
    return new ExpedientesSupabaseError(
      "Ya existe un expediente activo con el mismo NSS y programa.",
    );
  }

  if (error.code === "42501" || msg.includes("rol no autorizado") || msg.includes("no autenticado")) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para crear expedientes. Inicia sesión como asesor activo.",
    );
  }

  if (msg.includes("nss debe tener exactamente 11")) {
    return new ExpedientesSupabaseError("El NSS (IMSS) debe tener exactamente 11 dígitos.");
  }

  if (msg.includes("teléfono debe tener exactamente 10")) {
    return new ExpedientesSupabaseError(
      "El teléfono del cliente debe tener exactamente 10 dígitos (México).",
    );
  }

  if (msg.includes("nombre del cliente es obligatorio")) {
    return new ExpedientesSupabaseError("El nombre del cliente es requerido.");
  }

  return new ExpedientesSupabaseError(
    "No se pudo crear el expediente. Intenta de nuevo más tarde.",
  );
}

async function requireSupabaseSession(): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedientesSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user) {
    throw new ExpedientesSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }

  return { client, userId: session.user.id };
}

async function fetchExpedientesList(options?: {
  restrictToAsesor?: boolean;
}): Promise<ExpedienteMock[]> {
  const { client, userId } = await requireSupabaseSession();

  let query = client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT)
    .is("deleted_at", null);

  if (options?.restrictToAsesor) {
    query = query.eq("asesor_id", userId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Intenta de nuevo más tarde.",
    );
  }

  if (!data || data.length === 0) {
    return [];
  }

  return data.map((row) =>
    mapSupabaseRowToExpedienteMock(row as SupabaseExpedienteListRow),
  );
}

async function fetchExpedienteById(id: string): Promise<ExpedienteMock | null> {
  const idNorm = String(id).trim();
  if (!idNorm) return null;

  const { client } = await requireSupabaseSession();

  const { data, error } = await client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT)
    .eq("id", idNorm)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el expediente. Intenta de nuevo más tarde.",
    );
  }

  if (!data) return null;

  return mapSupabaseRowToExpedienteMock(data as SupabaseExpedienteListRow);
}

/**
 * Lectura vía RLS (JWT del usuario autenticado).
 * P3B.1: `listForAdmin()`; P3B.2: `listForAsesor()`; P3C: `createExpediente()`; P3D: `getById()`.
 */
export class SupabaseExpedientesRepo implements ExpedientesRepo {
  async listForAdmin(): Promise<ExpedienteMock[]> {
    return fetchExpedientesList();
  }

  async listForAsesor(_asesorEmail: string): Promise<ExpedienteMock[]> {
    void _asesorEmail;
    return fetchExpedientesList({ restrictToAsesor: true });
  }

  async getById(id: string): Promise<ExpedienteMock | null> {
    return fetchExpedienteById(id);
  }

  async createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("create_expediente", {
      p_programa: mapProgramaUiToDb(input.programa),
      p_nss: input.nss.trim(),
      p_cliente_nombre: input.cliente_nombre.trim(),
      p_telefono_cliente: input.telefono_cliente.trim(),
      p_direccion_opcional: input.direccion_opcional.trim(),
    });

    if (error) {
      throw mapCreateExpedienteRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo crear el expediente. Respuesta vacía del servidor.",
      );
    }

    return mapCreateExpedienteRpcToExpedienteMock(
      data as CreateExpedienteRpcResponse,
      input.asesorEmail,
    );
  }
}
