"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { MockExpedientesRepo } from "@/domain/expedientes/mock.repo";
import { canShowAgendaBiometricosForEtapa } from "@/lib/agendaFirmasBookingsGuard";
import {
  getAvailableTimeLabelsForDate,
  getNextAvailableSlotHints,
  tryWriteBiometricosBooking,
  validateSlotForBooking,
} from "@/lib/agendaBiometricosMock";
import {
  getAgendaBiometricosDisponibilidad,
  MockAgendaBiometricosLocalStorageRepo,
  type AgendaBiometricosLocationId,
  type HhmmTime,
  type YmdDate,
} from "@/domain/agenda-biometricos";

export interface AgendaBiometricosCardProps {
  expedienteId: string;
  submittedToMesa: boolean;
  etapaActual: number | null;
  subestado?: string | null;
  fechaCita: string | null | undefined;
  repo: MockExpedientesRepo;
  onUpdated: () => void;
}

function formatCitaDisplay(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-MX", {
      dateStyle: "full",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function AgendaBiometricosCard({
  expedienteId,
  submittedToMesa,
  etapaActual,
  subestado,
  fechaCita,
  repo,
  onUpdated,
}: AgendaBiometricosCardProps) {
  const agendaRepo = useMemo(() => new MockAgendaBiometricosLocalStorageRepo(), []);
  const [agendaConfig, setAgendaConfig] = useState(() => agendaRepo.readConfig());
  const locationOptions = useMemo(
    () => (agendaConfig?.locations ?? []).filter((l) => l.active !== false),
    [agendaConfig],
  );
  const [locationId, setLocationId] = useState<AgendaBiometricosLocationId>("monterrey");
  const [dateYmd, setDateYmd] = useState(() => {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const d = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}` as YmdDate;
  });
  const [timeHhmm, setTimeHhmm] = useState<HhmmTime | "">("");
  const [reagendar, setReagendar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  /** Fuerza recálculo de slots/hints al actualizar `agenda_bookings_v1`. */
  const [bookingsTick, setBookingsTick] = useState(0);

  useEffect(() => {
    if (!successMsg || typeof window === "undefined") return;
    const t = window.setTimeout(() => setSuccessMsg(null), 6000);
    return () => window.clearTimeout(t);
  }, [successMsg]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBookings = () => setBookingsTick((t) => t + 1);
    window.addEventListener("agenda_bookings_updated", onBookings);
    return () => window.removeEventListener("agenda_bookings_updated", onBookings);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onConfig = () => {
      setAgendaConfig(agendaRepo.readConfig());
      setTimeHhmm("");
      setError(null);
      setSuccessMsg(null);
    };
    window.addEventListener("agenda_config_updated", onConfig);
    return () => window.removeEventListener("agenda_config_updated", onConfig);
  }, [agendaRepo]);

  useEffect(() => {
    const ids = (locationOptions ?? []).map((l) => l.id);
    const first = ids[0];
    if (!first) return;
    if (!ids.includes(locationId)) {
      setLocationId(first);
    }
  }, [locationId, locationOptions]);

  const tieneCita = Boolean(fechaCita && String(fechaCita).trim() !== "");
  const etapa = etapaActual ?? 0;

  /** Solo etapa 4: el asesor agenda biométricos (Mesa no usa este componente). */
  const mostrarBloque =
    submittedToMesa && canShowAgendaBiometricosForEtapa(etapa);

  /** Formulario en etapa 4 sin cita aún. */
  const mostrarFormularioAgendar =
    etapa === 4 && !tieneCita && !reagendar && mostrarBloque;

  const mostrarResumen = mostrarBloque && tieneCita && !reagendar && etapa === 4;

  const mostrarFormularioReagendar = mostrarBloque && reagendar && tieneCita;

  const puedeReagendar = tieneCita && etapa === 4;

  const opcionesHora = useMemo(
    () => {
      void bookingsTick;
      if (!agendaConfig) return [];
      try {
        return getAvailableTimeLabelsForDate(
          dateYmd,
          locationId,
          expedienteId,
        );
      } catch {
        return [];
      }
    },
    [agendaConfig, bookingsTick, dateYmd, expedienteId, locationId],
  );

  /** Cupos por horario (disponible vs lleno) para la fecha y ubicación elegidas. */
  const disponibilidadSlots = useMemo(() => {
    void bookingsTick;
    if (!agendaConfig) return [];
    try {
      const bookings = agendaRepo.readBookings();
      return getAgendaBiometricosDisponibilidad({
        config: agendaConfig,
        bookings,
        date: dateYmd,
        locationId,
        excludeExpedienteId: expedienteId,
      });
    } catch {
      return [];
    }
  }, [agendaConfig, agendaRepo, bookingsTick, dateYmd, expedienteId, locationId]);

  /** Depende de `agenda_bookings_v1` vía evento + tick (no del inbox). */
  const hints = useMemo(() => {
    void bookingsTick;
    if (!agendaConfig) return [];
    try {
      return getNextAvailableSlotHints(expedienteId, locationId, 3);
    } catch {
      return [];
    }
  }, [agendaConfig, bookingsTick, expedienteId, locationId]);

  const aplicarHint = useCallback((h: { dateYmd: string; label: string }) => {
    setDateYmd(h.dateYmd as YmdDate);
    setTimeHhmm(h.label as HhmmTime);
    setError(null);
  }, []);

  const persistirCita = useCallback(async () => {
    setError(null);
    setSuccessMsg(null);
    if (!agendaConfig) {
      setError("Agenda no configurada. Mesa de control admin debe configurar biométricos.");
      return;
    }
    if (!timeHhmm) {
      setError("Selecciona un horario disponible.");
      return;
    }
    const v = validateSlotForBooking(dateYmd, timeHhmm as HhmmTime, locationId, expedienteId);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    const written = tryWriteBiometricosBooking({
      expedienteId,
      dateYmd,
      timeHhmm: timeHhmm as HhmmTime,
      locationId,
    });
    if (!written.ok) {
      setError(written.error);
      return;
    }
    setLoading(true);
    try {
      await repo.updateOperativo(expedienteId, {
        etapaActual: 4,
        subestado: "en_proceso",
        fechaCita: v.iso,
        submittedToMesa: true,
        motivoRechazo: null,
        comentarioRechazo: null,
        updatedAt: new Date().toISOString(),
      });
      setReagendar(false);
      setSuccessMsg("Cita de biométricos guardada.");
      onUpdated();
    } catch {
      written.rollback();
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [agendaConfig, dateYmd, expedienteId, locationId, onUpdated, repo, timeHhmm]);

  if (!mostrarBloque) return null;

  if (mostrarResumen && fechaCita) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 shadow-sm">
        <p className="text-sm font-semibold text-emerald-900">
          Cita de biométricos agendada
        </p>
        <p className="mt-2 text-xs text-emerald-950">
          <span className="font-medium">Fecha y hora:</span>{" "}
          {formatCitaDisplay(fechaCita)}
        </p>
        <p className="mt-1 text-xs text-emerald-800">
          <span className="font-medium">Estatus:</span>{" "}
          {etapa === 4
            ? "Cita agendada — etapa 4"
            : "Cita registrada — pendiente avance operativo"}
        </p>
        {puedeReagendar ? (
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full text-xs"
            disabled={loading}
            onClick={() => {
              setReagendar(true);
              const d = new Date(fechaCita);
              if (!Number.isNaN(d.getTime())) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                const ymd = `${y}-${m}-${day}` as YmdDate;
                setDateYmd(ymd);
                const lab = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                const opts = getAvailableTimeLabelsForDate(ymd, locationId, expedienteId);
                const next = (opts.includes(lab as HhmmTime) ? lab : (opts[0] ?? "")) as
                  | HhmmTime
                  | "";
                setTimeHhmm(next);
              }
              setError(null);
            }}
          >
            Reagendar cita
          </Button>
        ) : null}
      </div>
    );
  }

  if (mostrarFormularioAgendar || mostrarFormularioReagendar) {
    const citaRechazadaPorMesa =
      mostrarFormularioAgendar && subestado === "rechazado";

    return (
      <div className="rounded-xl border border-sky-200 bg-white p-3 shadow-sm">
        <p className="text-sm font-semibold text-gray-900">
          {mostrarFormularioReagendar
            ? "Reagendar cita de biométricos"
            : "Agendar cita de biométricos"}
        </p>
        {!agendaConfig ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950">
            No hay configuración de agenda (`agenda_config_v1`). Quien use el perfil Mesa Control -
            Admin (Cynthia) debe configurar ubicaciones, horarios y cupos.
          </p>
        ) : null}
        {citaRechazadaPorMesa ? (
          <p
            className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950"
            role="status"
          >
            La cita anterior fue rechazada por mesa. Selecciona una nueva fecha
            y hora.
          </p>
        ) : null}
        {successMsg ? (
          <p
            className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-950"
            role="status"
          >
            {successMsg}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] leading-snug text-gray-600">
          Horarios y cupos dependen 100% de la agenda configurada por mesa-control admin.
          Los botones muestran cupos restantes (disponible vs lleno). Al confirmar, el expediente
          pasa a etapa 4.
        </p>

        {mostrarFormularioReagendar ? (
          <button
            type="button"
            className="mt-2 text-[11px] font-medium text-sky-700 underline"
            onClick={() => {
              setReagendar(false);
              setError(null);
            }}
          >
            Cancelar reagendar
          </button>
        ) : null}

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-semibold text-gray-700">
            Ubicación
            <select
              className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value as AgendaBiometricosLocationId);
                setTimeHhmm("");
                setError(null);
                setSuccessMsg(null);
              }}
              disabled={!agendaConfig || loading}
            >
              {agendaConfig
                ? locationOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))
                : [{ id: "monterrey", label: "Monterrey" }].map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-gray-700">
            Fecha
            <input
              type="date"
              className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
              value={dateYmd}
              onChange={(e) => {
                setDateYmd(e.target.value as YmdDate);
                setTimeHhmm("");
                setSuccessMsg(null);
              }}
              disabled={loading}
            />
          </label>
          <div>
            <p className="text-[11px] font-semibold text-gray-700">Horario</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Verde: disponible · Gris: lleno · Selecciona un horario con cupo.
            </p>
            <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-gray-100 bg-gray-50/80 p-2">
              {disponibilidadSlots.length === 0 ? (
                <span className="text-[11px] text-gray-500">
                  Sin slots configurados este día / ubicación.
                </span>
              ) : (
                disponibilidadSlots.map((slot) => {
                  const lleno = slot.remaining <= 0;
                  const selected = timeHhmm === slot.time;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={lleno || loading}
                      onClick={() => {
                        setTimeHhmm(slot.time as HhmmTime);
                        setError(null);
                      }}
                      className={`rounded-md border px-2 py-1 text-left text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed ${
                        lleno
                          ? "border-gray-200 bg-gray-100 text-gray-400"
                          : selected
                            ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                            : "border-emerald-200/80 bg-emerald-50 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-100/80"
                      }`}
                    >
                      <span className="block">{slot.time}</span>
                      <span className="block text-[9px] font-normal opacity-90">
                        {lleno ? "Lleno" : `${slot.remaining} disp.`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {hints.length > 0 && !mostrarFormularioReagendar ? (
          <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Próximos horarios libres
            </p>
            <ul className="mt-1 space-y-1">
              {hints.map((h) => (
                <li key={`${h.dateYmd}-${h.label}`}>
                  <button
                    type="button"
                    disabled={loading}
                    className="text-left text-[11px] text-sky-700 underline disabled:text-gray-400 disabled:no-underline"
                    onClick={() => aplicarHint(h)}
                  >
                    {h.display}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}

        <Button
          type="button"
          variant="primary"
          className="mt-3 w-full text-xs"
          disabled={
            loading ||
            !agendaConfig ||
            opcionesHora.length === 0 ||
            !timeHhmm
          }
          onClick={() => void persistirCita()}
        >
          {loading
            ? "Guardando…"
            : mostrarFormularioReagendar
              ? "Guardar nueva cita"
              : "Agendar cita"}
        </Button>
        {opcionesHora.length === 0 && agendaConfig ? (
          <p className="mt-1 text-[10px] text-amber-800">
            No hay horarios con cupo ese día/ubicación; prueba otra fecha u otra ubicación.
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
