import { z } from "zod";

export const MESA_MARCADOR_TIPOS = ["tiene_datos"] as const;
export type MesaMarcadorTipo = (typeof MESA_MARCADOR_TIPOS)[number];

export const mesaMarcadorTipoSchema = z.enum(MESA_MARCADOR_TIPOS);

export type MesaExpedienteMarcador = Readonly<{
  expedienteId: string;
  tipo: MesaMarcadorTipo;
  active: boolean;
  updatedAt: string;
}>;

export type MesaSetExpedienteMarcadorResult = Readonly<{
  ok: boolean;
  idempotent: boolean;
  expedienteId: string;
  tipo: MesaMarcadorTipo;
  active: boolean;
  updatedAt: string;
}>;

export const mesaSetMarcadorRpcSchema = z.object({
  ok: z.boolean(),
  idempotent: z.boolean().optional(),
  expediente_id: z.string().uuid(),
  tipo: mesaMarcadorTipoSchema,
  active: z.boolean(),
  updated_at: z.string(),
});

export function isMesaMarcadorTipo(value: string): value is MesaMarcadorTipo {
  return (MESA_MARCADOR_TIPOS as readonly string[]).includes(value);
}
