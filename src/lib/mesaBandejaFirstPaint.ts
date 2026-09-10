import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import {
  deriveMesaCorreccionLecturaEstado,
  mesaEntradaEsPorCorreccion,
  resolveFechaEntradaMesaActual,
  type MesaCorreccionLecturaEstado,
} from "@/lib/mesaCorreccionEntrada";
import { getMesaExpedienteLastOpenedAt } from "@/lib/mesaExpedienteOpenedStorage";

/**
 * Hints que ya vienen en la RPC primaria de Mesa y alcanzan para pintar la tarjeta
 * correctamente ANTES del enrich secundario (docs/ops/agenda/etc.).
 */
export type MesaBandejaFirstPaintInput = Readonly<{
  expedienteId: string;
  fechaEnvioMesa?: string | null;
  createdAt?: string | null;
  cambioActionableAt?: string | null;
  categoriaResumen?: CategoriaResumenDocumental | null;
  opsHint?: Pick<
    MesaExpedienteOpsRow,
    "estadoMesa" | "assignedTo" | "assignedAt" | "lastActivityAt"
  > | null;
  mesaUserId?: string | null;
  /** Solo para prueba/determinismo. undefined = leer localStorage canónico. */
  lastOpenedAt?: string | null;
}>;

export type MesaBandejaFirstPaintHints = Readonly<{
  resumenDocumental?: CategoriaResumenDocumental;
  mesaOps: MesaExpedienteOpsRow | null;
  fechaEntradaMesaActual: string | null;
  entradaLecturaEsCorreccion: boolean;
  correccionLecturaEstado: MesaCorreccionLecturaEstado;
}>;

export function buildMesaBandejaFirstPaint(
  input: MesaBandejaFirstPaintInput,
): MesaBandejaFirstPaintHints {
  const actionable = String(input.cambioActionableAt ?? "").trim();
  const fechaEnvioMesa = String(input.fechaEnvioMesa ?? "").trim() || null;
  const createdAt = String(input.createdAt ?? "").trim() || null;
  const fechaEntradaMesaActual = actionable
    ? actionable
    : resolveFechaEntradaMesaActual(fechaEnvioMesa, null, createdAt);

  const lastOpenedAt =
    input.lastOpenedAt !== undefined
      ? input.lastOpenedAt
      : getMesaExpedienteLastOpenedAt(input.expedienteId, input.mesaUserId);

  const mesaOps: MesaExpedienteOpsRow | null = input.opsHint
    ? {
        expedienteId: input.expedienteId,
        assignedTo: input.opsHint.assignedTo ?? null,
        assignedToName: null,
        assignedAt: input.opsHint.assignedAt ?? null,
        estadoMesa: input.opsHint.estadoMesa,
        lastActivityAt: input.opsHint.lastActivityAt ?? null,
      }
    : null;

  return {
    resumenDocumental: input.categoriaResumen ?? undefined,
    mesaOps,
    fechaEntradaMesaActual,
    entradaLecturaEsCorreccion: mesaEntradaEsPorCorreccion(
      fechaEntradaMesaActual,
      fechaEnvioMesa,
    ),
    correccionLecturaEstado: deriveMesaCorreccionLecturaEstado(
      fechaEntradaMesaActual,
      lastOpenedAt ?? null,
    ),
  };
}
