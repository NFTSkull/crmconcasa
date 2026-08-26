import { z } from "zod";

export const VIGENCIA_DOCUMENTAL_LIMITE_DIAS = 45;

export const expedienteVigenciaDocumentalEstadoSchema = z.object({
  applicable: z.boolean(),
  reason: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  liberada_at: z.string().nullable().optional(),
  started_date: z.string().nullable().optional(),
  ultimo_dia_vigente: z.string().nullable().optional(),
  dias_transcurridos: z.number().nullable().optional(),
  limite_dias: z.number().default(VIGENCIA_DOCUMENTAL_LIMITE_DIAS),
  dias_restantes: z.number().nullable().optional(),
  vencido: z.boolean().default(false),
  tracking_unknown: z.boolean().default(false),
  comprobante_documento_id: z.string().uuid().nullable().optional(),
  comprobante_fresco: z.boolean().default(false),
  estado_cuenta_documento_id: z.string().uuid().nullable().optional(),
  estado_cuenta_fresco: z.boolean().default(false),
  docs_frescos_completos: z.boolean().default(false),
  reingreso_requerido: z.boolean().default(false),
  listo_para_continuar: z.boolean().default(true),
  reingreso_completado_at: z.string().nullable().optional(),
  blocking_reason: z.string().nullable().optional(),
  missing_comprobante: z.boolean().optional(),
  missing_estado_cuenta: z.boolean().optional(),
});

export type ExpedienteVigenciaDocumentalEstado = z.infer<
  typeof expedienteVigenciaDocumentalEstadoSchema
>;

export function parseExpedienteVigenciaDocumentalEstado(
  raw: unknown,
): ExpedienteVigenciaDocumentalEstado | null {
  if (raw == null) return null;
  const parsed = expedienteVigenciaDocumentalEstadoSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Copy corto para header asesor. */
export function formatVigenciaDocumentalHeader(
  estado: ExpedienteVigenciaDocumentalEstado,
  etapaActual: number,
): string | null {
  if (!estado.applicable) return null;
  if (estado.tracking_unknown) return "Vigencia pendiente de determinar";
  if (estado.vencido) return "Vencido · Reingreso por vigencia";
  const dias = estado.dias_transcurridos ?? 0;
  const limite = estado.limite_dias ?? VIGENCIA_DOCUMENTAL_LIMITE_DIAS;
  const restantes = estado.dias_restantes ?? Math.max(limite - dias, 0);
  if (dias >= limite) return `Último día · ${limite} de ${limite}`;
  if (restantes <= 5 && restantes >= 1) {
    return restantes === 1 ? "1 día restante" : `${restantes} días restantes`;
  }
  return `Etapa ${etapaActual} · Día ${dias} de ${limite}`;
}
