import { z } from "zod";

export const ingresosMontoFuenteSchema = z.enum([
  "mesa_actualizado",
  "datos_generales",
]);

export const ingresosEstadoFiltroSchema = z.enum([
  "elegibles",
  "pendientes",
  "pagados",
]);

export type IngresosEstadoFiltro = z.infer<typeof ingresosEstadoFiltroSchema>;

const num = z.coerce.number();

export const ingresosResumenSchema = z.object({
  ingreso_proyectado: num,
  ingreso_real: num,
  pendiente_por_cobrar: num,
  cumplimiento_pct: num,
  expedientes_proyectados: z.coerce.number().int(),
  expedientes_pagados: z.coerce.number().int(),
  expedientes_pendientes: z.coerce.number().int(),
  ticket_promedio_proyectado: num,
  ticket_promedio_real: num,
  sin_datos_cobro: z
    .object({
      total: z.coerce.number().int(),
      sin_porcentaje: z.coerce.number().int(),
      sin_monto: z.coerce.number().int(),
      sin_ambos: z.coerce.number().int(),
      items: z
        .array(
          z.object({
            expediente_id: z.string().uuid(),
            cliente_nombre: z.string().nullable().optional(),
            nss: z.string().nullable().optional(),
            reason: z.string(),
          }),
        )
        .default([]),
    })
    .passthrough(),
  por_asesor: z
    .array(
      z.object({
        asesor_id: z.string().uuid(),
        asesor_nombre: z.string(),
        expedientes: z.coerce.number().int(),
        ingreso_proyectado: num,
        ingreso_real: num,
        pendiente: num,
        cumplimiento_pct: num,
      }),
    )
    .default([]),
  por_porcentaje: z
    .array(
      z.object({
        porcentaje_cobro: num,
        expedientes: z.coerce.number().int(),
        ingreso_proyectado: num,
        ingreso_real: num,
      }),
    )
    .default([]),
  por_fuente_monto: z
    .array(
      z.object({
        monto_fuente: ingresosMontoFuenteSchema,
        expedientes: z.coerce.number().int(),
        ingreso_proyectado: num,
        ingreso_real: num,
      }),
    )
    .default([]),
  tendencia: z
    .array(
      z.object({
        fecha: z.string(),
        proyectado: num,
        real: num,
      }),
    )
    .default([]),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type IngresosResumen = z.infer<typeof ingresosResumenSchema>;

export const ingresosDetalleItemSchema = z.object({
  expediente_id: z.string().uuid(),
  cliente_nombre: z.string().nullable().optional(),
  nss: z.string().nullable().optional(),
  asesor_id: z.string().uuid().nullable().optional(),
  asesor_nombre: z.string().nullable().optional(),
  etapa_actual: z.coerce.number().int(),
  paso_visual: z.coerce.number().int().nullable().optional(),
  subestado: z.string().nullable().optional(),
  ciclo_estado: z.string().nullable().optional(),
  bio_aprobacion_at: z.string().nullable().optional(),
  pago_concasa_at: z.string().nullable().optional(),
  monto_general: num.nullable().optional(),
  monto_actualizado: num.nullable().optional(),
  monto_base: num.nullable().optional(),
  monto_fuente: ingresosMontoFuenteSchema.nullable().optional(),
  porcentaje_cobro: num.nullable().optional(),
  ingreso_proyectado: num.nullable().optional(),
  ingreso_real: num.nullable().optional(),
  pendiente: num.nullable().optional(),
  is_historical_estimate: z.boolean().optional(),
  calculo: z.string().nullable().optional(),
});

export const ingresosPageSchema = z.object({
  total: z.coerce.number().int(),
  page: z.coerce.number().int(),
  page_size: z.coerce.number().int(),
  items: z.array(ingresosDetalleItemSchema).default([]),
});

export type IngresosPage = z.infer<typeof ingresosPageSchema>;
export type IngresosDetalleItem = z.infer<typeof ingresosDetalleItemSchema>;

export type IngresosFilters = Readonly<{
  fechaDesde: string | null;
  fechaHasta: string | null;
  asesorIds: readonly string[];
  montoFuente: "todas" | "mesa_actualizado" | "datos_generales";
  porcentajes: readonly number[];
  pasosVisuales: readonly number[];
  estado: IngresosEstadoFiltro;
  buscar: string;
}>;
