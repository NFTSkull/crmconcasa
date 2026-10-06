"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MesaAccordionSection } from "@/components/mesa-control/MesaAccordionSection";
import {
  fetchMesaCorreccionesHistorial,
  type MesaCorreccionHistorialEvent,
} from "@/domain/expedientes/mesa-correcciones-historial";

type Props = Readonly<{
  expedienteId: string;
  loadReady: boolean;
}>;

const TARGET_LABELS: Record<string, string> = {
  datos_generales: "Datos generales",
  cliente_ine_frente: "INE frente",
  cliente_ine_reverso: "INE reverso",
  cliente_comprobante_domicilio: "Comprobante de domicilio",
  cliente_estado_cuenta: "Estado de cuenta",
  cliente_acta_nacimiento_digital: "Acta de nacimiento",
  cliente_semanas_o_vigencia_derechos: "Semanas cotizadas / Vigencia de derechos",
  cliente_constancia_situacion_fiscal: "Constancia de situación fiscal",
};

function targetLabel(key: string | null): string | null {
  if (!key) return null;
  if (TARGET_LABELS[key]) return TARGET_LABELS[key]!;
  return key
    .replace(/^cliente_/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function tone(event: MesaCorreccionHistorialEvent): {
  dot: string;
  box: string;
  badge: string;
  label: string;
} {
  switch (event.kind) {
    case "correccion_solicitada":
      return {
        dot: "bg-amber-500",
        box: "border-amber-200 bg-amber-50/60",
        badge: "bg-amber-100 text-amber-950",
        label: "Solicitada",
      };
    case "correccion_recibida":
      return {
        dot: "bg-sky-500",
        box: "border-sky-200 bg-sky-50/60",
        badge: "bg-sky-100 text-sky-950",
        label: "Recibida",
      };
    case "correccion_revisada":
      return {
        dot: "bg-emerald-500",
        box: "border-emerald-200 bg-emerald-50/60",
        badge: "bg-emerald-100 text-emerald-950",
        label: "Revisada",
      };
    default:
      return {
        dot: "bg-slate-400",
        box: "border-slate-200 bg-slate-50/70",
        badge: "bg-slate-100 text-slate-800",
        label: "Envío a Mesa",
      };
  }
}

export function MesaCorreccionesHistorialPanel({
  expedienteId,
  loadReady,
}: Props) {
  const [events, setEvents] = useState<readonly MesaCorreccionHistorialEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!expedienteId || !loadReady) return;
    setLoading(true);
    setError(null);
    try {
      setEvents(await fetchMesaCorreccionesHistorial(expedienteId));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el historial de correcciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [expedienteId, loadReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const solicitadas = events.filter((e) => e.kind === "correccion_solicitada").length;
    const recibidas = events.filter((e) => e.kind === "correccion_recibida").length;
    const revisadas = events.filter((e) => e.kind === "correccion_revisada").length;
    return { solicitadas, recibidas, revisadas };
  }, [events]);

  const summary = loading
    ? "Cargando…"
    : stats.solicitadas === 0
      ? "Sin correcciones solicitadas"
      : `${stats.solicitadas} solicitada${stats.solicitadas === 1 ? "" : "s"} · ${stats.recibidas} recibida${stats.recibidas === 1 ? "" : "s"}`;

  return (
    <MesaAccordionSection
      id="mesa-historial-correcciones"
      title="Historial de correcciones"
      summary={summary}
    >
      <div className="space-y-4 px-4 py-3" data-testid="mesa-historial-correcciones">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          Solo muestra el ciclo de correcciones del expediente: envío a Mesa,
          solicitudes, reenvíos del asesor y revisión de Mesa. No modifica etapas,
          documentos ni citas.
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <p>{error}</p>
            <button
              type="button"
              className="mt-1 font-semibold underline"
              onClick={() => void refresh()}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {!loading && !error && events.length === 0 ? (
          <p className="text-sm text-gray-500">
            Todavía no hay eventos de corrección registrados para este expediente.
          </p>
        ) : null}

        <ol className="relative space-y-3 border-l border-gray-200 pl-5">
          {events.map((event) => {
            const ui = tone(event);
            const target = targetLabel(event.targetKey);
            return (
              <li key={event.id} className="relative">
                <span
                  className={`absolute -left-[1.55rem] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-white ${ui.dot}`}
                  aria-hidden
                />
                <div className={`rounded-lg border px-3 py-2.5 ${ui.box}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {event.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {formatDateTime(event.occurredAt)}
                        {event.actorName ? ` · ${event.actorName}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ui.badge}`}>
                      {ui.label}
                    </span>
                  </div>

                  {target ? (
                    <p className="mt-2 text-xs text-gray-700">
                      <span className="font-semibold">Sección:</span> {target}
                    </p>
                  ) : null}

                  {event.reason ? (
                    <div className="mt-2 rounded-md border border-white/70 bg-white/75 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Motivo solicitado por Mesa
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-900">
                        {event.reason}
                      </p>
                    </div>
                  ) : null}

                  {event.kind === "correccion_recibida" ? (
                    <div className="mt-2">
                      {event.requestAt ? (
                        <p className="text-[11px] text-gray-600">
                          Responde a la solicitud del {formatDateTime(event.requestAt)}.
                        </p>
                      ) : null}
                      {event.changes.length > 0 ? (
                        <div className="mt-2 rounded-md border border-white/70 bg-white/75 px-2.5 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Correcciones enviadas por el asesor
                          </p>
                          <ul className="mt-1 space-y-1 text-xs text-gray-900">
                            {event.changes.map((change) => (
                              <li key={change.id} className="flex gap-1.5">
                                <span aria-hidden>•</span>
                                <span>{change.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-gray-600">
                          El asesor reenvió la corrección a Mesa.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </MesaAccordionSection>
  );
}
