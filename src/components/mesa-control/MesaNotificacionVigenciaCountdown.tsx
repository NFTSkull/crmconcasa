"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

type NotificacionVigenciaEstado = Readonly<{
  applicable: boolean;
  reason?: string | null;
  documento_id?: string | null;
  tipo_documento?: string | null;
  started_at?: string | null;
  expires_at?: string | null;
  limite_dias?: number | null;
  dias_transcurridos?: number | null;
  dias_restantes?: number | null;
  vencido?: boolean | null;
  should_reject?: boolean | null;
}>;

function parseEstado(raw: unknown): NotificacionVigenciaEstado | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.applicable !== "boolean") return null;

  const asNullableString = (key: string): string | null | undefined => {
    const v = value[key];
    if (v === undefined) return undefined;
    if (v === null) return null;
    return typeof v === "string" ? v : undefined;
  };
  const asNullableNumber = (key: string): number | null | undefined => {
    const v = value[key];
    if (v === undefined) return undefined;
    if (v === null) return null;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  return {
    applicable: value.applicable,
    reason: asNullableString("reason"),
    documento_id: asNullableString("documento_id"),
    tipo_documento: asNullableString("tipo_documento"),
    started_at: asNullableString("started_at"),
    expires_at: asNullableString("expires_at"),
    limite_dias: asNullableNumber("limite_dias"),
    dias_transcurridos: asNullableNumber("dias_transcurridos"),
    dias_restantes: asNullableNumber("dias_restantes"),
    vencido: typeof value.vencido === "boolean" ? value.vencido : undefined,
    should_reject:
      typeof value.should_reject === "boolean" ? value.should_reject : undefined,
  };
}

function formatDateEsMx(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function MesaNotificacionVigenciaCountdown({
  expedienteId,
}: Readonly<{
  expedienteId: string;
}>) {
  const [estado, setEstado] = useState<NotificacionVigenciaEstado | null>(null);

  const load = useCallback(async () => {
    if (!expedienteId || !isSupabaseConfigured() || !supabaseBrowser) {
      setEstado(null);
      return;
    }

    const { data, error } = await supabaseBrowser.rpc(
      "expediente_notificacion_vigencia_estado",
      { p_expediente_id: expedienteId },
    );

    // Fail-soft: este indicador nunca debe bloquear la operación de Mesa.
    if (error) {
      setEstado(null);
      return;
    }
    setEstado(parseEstado(data));
  }, [expedienteId]);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  if (!estado?.applicable) return null;

  const limite = estado.limite_dias ?? 30;
  const restantes = Math.max(estado.dias_restantes ?? 0, 0);
  const transcurridos = Math.max(estado.dias_transcurridos ?? 0, 0);
  const vence = formatDateEsMx(estado.expires_at);

  if (estado.vencido) {
    return (
      <div
        className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        role="status"
        data-testid="mesa-notificacion-vigencia"
      >
        <p className="font-semibold">Notificación vencida</p>
        <p className="mt-1 text-xs">
          Superó {limite} días sin llegar a firma ni Pago ConCasa. El sistema la
          regresará al asesor para actualizar el Estado de Cuenta.
        </p>
      </div>
    );
  }

  const nearExpiry = restantes <= 5;
  return (
    <div
      className={
        nearExpiry
          ? "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          : "rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
      }
      role="status"
      data-testid="mesa-notificacion-vigencia"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {nearExpiry ? "Notificación por vencer" : "Notificación vigente"}
        </p>
        <span className="text-xs font-semibold">
          {restantes === 1 ? "1 día restante" : `${restantes} días restantes`}
        </span>
      </div>
      <p className="mt-1 text-xs">
        Día {Math.min(transcurridos, limite)} de {limite}
        {vence ? ` · vence ${vence}` : ""}. Al agendar firma, avanzar a firma o
        registrar Pago ConCasa, este conteo se cierra automáticamente.
      </p>
    </div>
  );
}
