import { supabase } from "@/lib/supabaseClient";
import type { Precalificacion, CreatePrecalificacionInput } from "./types";
import type { PrecalificacionesRepo } from "./repo";
import {
  validateCreatePrecalificacion,
  validateUpdatePrecalificacion,
} from "./validators";

function safeMontoFromDb(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const n = Math.trunc(value);
    return Number.isFinite(n) ? n : null;
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (raw === "") return null;

    // Acepta: "13000", "13000.00", "13000.0000", "21745.000000", "500000.0"
    const m = raw.match(/^(\d+)(?:\.(\d+))?$/);
    if (!m) return null;

    const intPart = m[1];
    const fracPart = m[2];
    if (fracPart != null && !/^0+$/.test(fracPart)) return null;

    const n = Number(intPart);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
    return n;
  }

  return null;
}

/** Mapea fila de Supabase (camelCase o snake_case) a Precalificacion de dominio */
function rowToPrecalificacion(row: Record<string, unknown>): Precalificacion {
  return {
    id: String(row.id ?? ""),
    asesorId: String(row.asesor_id ?? row.asesorId ?? ""),
    programa: row.programa as Precalificacion["programa"],
    nss: String(row.nss ?? ""),
    cliente_nombre: String(row.cliente_nombre ?? ""),
    telefono_cliente: String(row.telefono_cliente ?? ""),
    fecha_nacimiento: row.fecha_nacimiento != null ? String(row.fecha_nacimiento) : undefined,
    direccion_opcional: String(row.direccion_opcional ?? ""),
    monto_aprobado: safeMontoFromDb(row.monto_aprobado),
    notas: String(row.notas ?? ""),
    createdAt: row.created_at != null ? String(row.created_at) : String(row.createdAt ?? ""),
    decision: row.decision as Precalificacion["decision"] | undefined,
    notas_revision: row.notas_revision != null ? String(row.notas_revision) : undefined,
  };
}

export class SupabasePrecalificacionesRepo implements PrecalificacionesRepo {
  async listForUser(user: {
    email: string;
    role: string;
  }): Promise<Precalificacion[]> {
    if (user.role === "asesor") {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return [];
      const { data, error } = await supabase
        .from("precalificaciones")
        .select("*")
        .eq("asesorId", uid)
        .order("createdAt", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(rowToPrecalificacion);
    }
    const { data, error } = await supabase
      .from("precalificaciones")
      .select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToPrecalificacion);
  }

  async listPageForUser(
    user: { email: string; role: string },
    options: { page: number; pageSize: number }
  ): Promise<{ data: Precalificacion[]; count: number }> {
    const { page, pageSize } = options;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (user.role === "asesor") {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return { data: [], count: 0 };
      const { data, error, count } = await supabase
        .from("precalificaciones")
        .select("*", { count: "exact" })
        .eq("asesorId", uid)
        .order("createdAt", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return {
        data: (data ?? []).map(rowToPrecalificacion),
        count: count ?? 0,
      };
    }

    const { data, error, count } = await supabase
      .from("precalificaciones")
      .select("*", { count: "exact" })
      .order("createdAt", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return {
      data: (data ?? []).map(rowToPrecalificacion),
      count: count ?? 0,
    };
  }

  async getById(id: string): Promise<Precalificacion | null> {
    const { data, error } = await supabase
      .from("precalificaciones")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToPrecalificacion(data) : null;
  }

  async create(input: CreatePrecalificacionInput): Promise<Precalificacion> {
    validateCreatePrecalificacion(input);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      throw new Error("No hay usuario autenticado. Inicia sesión como asesor.");
    }
    const row = {
      programa: input.programa,
      nss: input.nss,
      cliente_nombre: input.cliente_nombre,
      telefono_cliente: input.telefono_cliente,
      direccion_opcional: input.direccion_opcional ?? "",
      notas: "",
      decision: "pendiente",
      asesorId: uid,
    };
    const { data, error } = await supabase
      .from("precalificaciones")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToPrecalificacion(data);
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        Precalificacion,
        "decision" | "monto_aprobado" | "notas_revision" | "notas"
      >
    >
  ): Promise<Precalificacion> {
    validateUpdatePrecalificacion(patch);
    const updatePayload: Record<string, unknown> = {};
    if (patch.decision !== undefined) updatePayload.decision = patch.decision;
    if (patch.monto_aprobado !== undefined) updatePayload.monto_aprobado = patch.monto_aprobado;
    if (patch.notas_revision !== undefined) updatePayload.notas_revision = patch.notas_revision;
    if (patch.notas !== undefined) updatePayload.notas = patch.notas;
    const { data, error } = await supabase
      .from("precalificaciones")
      .update(updatePayload)
      .eq("id", id)
      .select("*");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (row) return rowToPrecalificacion(row);
    const merged = { id, ...patch };
    return rowToPrecalificacion(merged as Record<string, unknown>);
  }
}
