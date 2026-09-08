import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export type PagoConcasaTipoMovimiento = "parcial" | "total";

export type PagoConcasaMovimiento = Readonly<{
  id: string;
  tipo: PagoConcasaTipoMovimiento;
  monto: number;
  notas: string | null;
  montoObjetivoSnapshot: number;
  acumuladoAntes: number;
  saldoDespues: number;
  actorId: string | null;
  actorNombre: string | null;
  actorEmail: string | null;
  createdAt: string;
}>;

export type PagoConcasaEstado = Readonly<{
  expedienteId: string;
  etapaActual: number | null;
  resultadoFinal: "pagado" | "no_pagado" | null;
  resultadoAt: string | null;
  montoObjetivo: number | null;
  pagadoAcumulado: number;
  saldoPendiente: number | null;
  puedeRegistrar: boolean;
  finalizado: boolean;
  legacy: boolean;
  movimientos: readonly PagoConcasaMovimiento[];
}>;

export class PagoConcasaPagosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PagoConcasaPagosError";
  }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseEstado(data: unknown): PagoConcasaEstado {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PagoConcasaPagosError("El servidor devolvió un estado de pago inválido.");
  }
  const row = data as Record<string, unknown>;
  const movimientosRaw = Array.isArray(row.movimientos) ? row.movimientos : [];
  const movimientos: PagoConcasaMovimiento[] = movimientosRaw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const m = item as Record<string, unknown>;
    const tipo = m.tipo === "parcial" || m.tipo === "total" ? m.tipo : null;
    const monto = finiteNumber(m.monto);
    const montoObjetivo = finiteNumber(m.monto_objetivo_snapshot);
    const acumuladoAntes = finiteNumber(m.acumulado_antes);
    const saldoDespues = finiteNumber(m.saldo_despues);
    const createdAt = nullableString(m.created_at);
    if (!tipo || monto == null || montoObjetivo == null || acumuladoAntes == null || saldoDespues == null || !createdAt) {
      return [];
    }
    return [{
      id: nullableString(m.id) ?? `${createdAt}-${monto}`,
      tipo,
      monto,
      notas: nullableString(m.notas),
      montoObjetivoSnapshot: montoObjetivo,
      acumuladoAntes,
      saldoDespues,
      actorId: nullableString(m.actor_id),
      actorNombre: nullableString(m.actor_nombre),
      actorEmail: nullableString(m.actor_email),
      createdAt,
    }];
  });

  const resultado =
    row.resultado_final === "pagado" || row.resultado_final === "no_pagado"
      ? row.resultado_final
      : null;

  return {
    expedienteId: nullableString(row.expediente_id) ?? "",
    etapaActual: finiteNumber(row.etapa_actual),
    resultadoFinal: resultado,
    resultadoAt: nullableString(row.resultado_at),
    montoObjetivo: finiteNumber(row.monto_objetivo),
    pagadoAcumulado: finiteNumber(row.pagado_acumulado) ?? 0,
    saldoPendiente: finiteNumber(row.saldo_pendiente),
    puedeRegistrar: row.puede_registrar === true,
    finalizado: row.finalizado === true,
    legacy: row.legacy === true,
    movimientos,
  };
}

function requireClient() {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new PagoConcasaPagosError("Supabase no está configurado.");
  }
  return supabaseBrowser;
}

export async function fetchPagoConcasaEstado(
  expedienteId: string,
): Promise<PagoConcasaEstado> {
  const id = String(expedienteId ?? "").trim();
  if (!id) throw new PagoConcasaPagosError("El expediente es obligatorio.");
  const client = requireClient();
  const { data, error } = await client.rpc("pago_concasa_estado", {
    p_expediente_id: id,
  });
  if (error) {
    throw new PagoConcasaPagosError(
      error.message || "No se pudo consultar el estado de Pago a ConCasa.",
    );
  }
  return parseEstado(data);
}

export async function registrarPagoConcasa(
  expedienteId: string,
  input: Readonly<{
    tipo: PagoConcasaTipoMovimiento;
    monto?: number | null;
    notas?: string | null;
  }>,
): Promise<PagoConcasaEstado> {
  const id = String(expedienteId ?? "").trim();
  if (!id) throw new PagoConcasaPagosError("El expediente es obligatorio.");
  const client = requireClient();
  const notas = input.notas?.trim() || null;
  const { data, error } = await client.rpc("registrar_pago_concasa", {
    p_expediente_id: id,
    p_tipo: input.tipo,
    p_monto: input.tipo === "parcial" ? (input.monto ?? null) : null,
    p_notas: notas,
  });
  if (error) {
    throw new PagoConcasaPagosError(
      error.message || "No se pudo registrar el pago a ConCasa.",
    );
  }
  return parseEstado(data);
}
