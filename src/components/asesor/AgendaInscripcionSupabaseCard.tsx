"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  formatInscripcionCupoLabel,
  formatInscripcionFixedTimeDisplay,
  INSCRIPCION_FIXED_TIME_DISPLAY,
  isInscripcionAgendarCtaVisible,
  isInscripcionManageVisible,
  useAgendaInscripcionRepo,
  type AgendaInscripcionActiveBooking,
  type AgendaInscripcionRequirement,
} from "@/domain/agenda-inscripcion";
import { SupabaseAgendaInscripcionRepo } from "@/domain/agenda-inscripcion/supabase.repo";
import {
  BOOK_SLOT_JUST_TAKEN_MESSAGE,
  LIVE_SYNC_LOADING_LABEL,
  invokeAgendaSheetLiveSync,
} from "@/domain/agenda-sheets/live-inventory-sync";
import { formatMesaAgendaSedeLabel } from "@/lib/mesaAgendaCitasUi";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type AgendaInscripcionSupabaseCardProps = Readonly<{
  expedienteId: string;
  onUpdated?: () => void;
  /**
   * En tab embebido: si no hay requirement, muestra estado informativo
   * (nunca CTA). Standalone (default false) puede ocultarse con null.
   */
  embedded?: boolean;
}>;

/** P175 V1: inscripción solo Monterrey. */
const INSCRIPCION_SEDE = "monterrey" as const;

function todayYmdMonterrey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function InscripcionNoRequeridaState() {
  return (
    <section
      className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-3"
      data-testid="inscripcion-no-requerida"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-teal-950">
          Cita de inscripción
        </h3>
        <span className="rounded-full bg-teal-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-teal-800 ring-1 ring-teal-200">
          No requerida
        </span>
      </div>
      <p className="mt-2 text-xs leading-snug text-teal-900">
        La cita de inscripción se habilita cuando Mesa la solicite o cuando el
        resultado de biométricos indique que la inscripción debe reagendarse.
      </p>
    </section>
  );
}

export function AgendaInscripcionSupabaseCard({
  expedienteId,
  onUpdated,
  embedded = false,
}: AgendaInscripcionSupabaseCardProps) {
  const repo = useAgendaInscripcionRepo();
  const busyRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [requirement, setRequirement] =
    useState<AgendaInscripcionRequirement | null>(null);
  const [booking, setBooking] =
    useState<AgendaInscripcionActiveBooking | null>(null);
  const [date, setDate] = useState(() => addDaysYmd(todayYmdMonterrey(), 1));
  const [available, setAvailable] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [availLoading, setAvailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "book" | "reagendar">("idle");

  const reload = useCallback(async () => {
    if (!repo) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [req, active] = await Promise.all([
        repo.getOpenRequirement(expedienteId),
        repo.getActiveBooking(expedienteId),
      ]);
      setRequirement(req);
      setBooking(active);
      if (active) {
        setDate(active.bookingDate);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo cargar la cita de inscripción.",
      );
    } finally {
      setLoading(false);
    }
  }, [repo, expedienteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshAvailability = useCallback(async () => {
    if (!repo || !date) return;
    setAvailLoading(true);
    try {
      try {
        await invokeAgendaSheetLiveSync(supabaseBrowser!, {
          kind: "inscripcion",
          mode: "availability",
          bookingDate: date,
          locationId: INSCRIPCION_SEDE,
        });
      } catch {
        // fail-soft: inventory RPC sigue
      }
      const slots = await repo.listAvailability({
        fromDate: date,
        toDate: date,
        locationId: INSCRIPCION_SEDE,
      });
      const slot = slots[0];
      setAvailable(slot?.available ?? 0);
      setCapacity(slot?.capacity ?? 0);
    } catch {
      setAvailable(0);
      setCapacity(0);
    } finally {
      setAvailLoading(false);
    }
  }, [repo, date]);

  useEffect(() => {
    if (mode === "book" || mode === "reagendar") {
      void refreshAvailability();
    }
  }, [mode, refreshAvailability]);

  const showCard =
    requirement != null &&
    (requirement.status === "pending_booking" ||
      requirement.status === "booked" ||
      requirement.status === "rebook_required");

  if (!repo) return null;
  if (loading) {
    return (
      <section
        className="rounded-xl border border-teal-200 bg-teal-50/40 px-4 py-3 text-sm text-teal-900"
        data-testid="inscripcion-card-loading"
      >
        Cargando cita de inscripción…
      </section>
    );
  }
  if (!showCard || !requirement) {
    return embedded ? <InscripcionNoRequeridaState /> : null;
  }

  const canAgendar = isInscripcionAgendarCtaVisible(requirement.status);
  const canManage = isInscripcionManageVisible(requirement.status);
  const cupoLabel = formatInscripcionCupoLabel(available, capacity);
  const noCupo = available <= 0;
  const sedeLabel = formatMesaAgendaSedeLabel(INSCRIPCION_SEDE);

  const handleBook = async () => {
    if (busyRef.current || !repo) return;
    if (
      !window.confirm(
        `¿Confirmas la cita de inscripción para el ${date} a las ${INSCRIPCION_FIXED_TIME_DISPLAY} en ${sedeLabel}?`,
      )
    ) {
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      try {
        await invokeAgendaSheetLiveSync(supabaseBrowser!, {
          kind: "inscripcion",
          mode: "book_gate",
          bookingDate: date,
          locationId: INSCRIPCION_SEDE,
        });
      } catch {
        /* RPC claim es autoridad */
      }
      const result = await repo.book({
        expedienteId,
        bookingDate: date,
        locationId: INSCRIPCION_SEDE,
      });
      if (!result.ok) {
        setError(result.message ?? BOOK_SLOT_JUST_TAKEN_MESSAGE);
        await refreshAvailability();
        return;
      }
      setSuccess("Cita de inscripción agendada correctamente.");
      setMode("idle");
      await reload();
      onUpdated?.();
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  };

  const handleReagendar = async () => {
    if (busyRef.current || !repo) return;
    if (
      !window.confirm(
        `¿Confirmas reagendar la cita de inscripción al ${date} a las ${INSCRIPCION_FIXED_TIME_DISPLAY} en ${sedeLabel}?`,
      )
    ) {
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      try {
        await invokeAgendaSheetLiveSync(supabaseBrowser!, {
          kind: "inscripcion",
          mode: "book_gate",
          bookingDate: date,
          locationId: INSCRIPCION_SEDE,
        });
      } catch {
        /* claim atómico en RPC */
      }
      const result = await repo.reagendar({
        expedienteId,
        bookingDate: date,
        locationId: INSCRIPCION_SEDE,
      });
      if (!result.ok) {
        setError(result.message ?? BOOK_SLOT_JUST_TAKEN_MESSAGE);
        await refreshAvailability();
        return;
      }
      setSuccess("Cita de inscripción reagendada correctamente.");
      setMode("idle");
      await reload();
      onUpdated?.();
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  };

  const handleCancel = async () => {
    if (busyRef.current || !repo) return;
    if (!window.confirm("¿Confirmas cancelar esta cita de inscripción?")) {
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await repo.cancel({ expedienteId });
      if (!result.ok) {
        setError(result.message ?? "No se pudo cancelar la cita.");
        return;
      }
      setSuccess("Cita cancelada. Puedes agendar una nueva inscripción.");
      setMode("idle");
      await reload();
      onUpdated?.();
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  };

  return (
    <section
      className={
        embedded
          ? "rounded-lg border border-teal-200 bg-teal-50/40 px-3 py-3"
          : "rounded-xl border border-teal-300 bg-teal-50/70 px-4 py-3 shadow-sm"
      }
      data-testid="inscripcion-supabase-card"
      id={`inscripcion-${expedienteId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-teal-950">
          Cita de inscripción
        </h3>
        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-teal-900 ring-1 ring-teal-200">
          Inscripción
        </span>
      </div>
      <p className="mt-1 text-xs text-teal-900">
        Los biométricos del cliente ya fueron realizados, pero necesita
        regresar para concluir su inscripción.
      </p>

      {canManage && booking ? (
        <dl className="mt-2 grid gap-1 text-xs text-teal-950 sm:grid-cols-3">
          <div>
            <dt className="text-teal-800">Fecha</dt>
            <dd className="font-medium">{booking.bookingDate}</dd>
          </div>
          <div>
            <dt className="text-teal-800">Hora</dt>
            <dd className="font-medium">
              {formatInscripcionFixedTimeDisplay(booking.bookingTime)}
            </dd>
          </div>
          <div>
            <dt className="text-teal-800">Sede</dt>
            <dd className="font-medium">
              {formatMesaAgendaSedeLabel(booking.locationId)}
            </dd>
          </div>
        </dl>
      ) : null}

      {requirement.reason ? (
        <p className="mt-2 rounded-md border border-teal-200 bg-white/70 px-2 py-1.5 text-xs text-teal-950">
          Motivo: {requirement.reason}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-2 text-xs font-medium text-emerald-800">{success}</p>
      ) : null}

      {(mode === "book" || mode === "reagendar") && (
        <div className="mt-3 space-y-2 rounded-lg border border-teal-200 bg-white/80 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-teal-900">
              Fecha
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-teal-200 px-2 py-1.5 text-sm"
                min={todayYmdMonterrey()}
                value={date}
                disabled={saving}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <div className="block text-xs text-teal-900">
              Sede
              <p className="mt-1 rounded-md border border-teal-100 bg-teal-50/60 px-2 py-1.5 text-sm font-medium text-teal-950">
                Monterrey
              </p>
            </div>
          </div>
          <p className="text-xs text-teal-900">
            Hora: <strong>{INSCRIPCION_FIXED_TIME_DISPLAY}</strong>
            <span className="ml-2 text-teal-700">
              {availLoading ? LIVE_SYNC_LOADING_LABEL : cupoLabel}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={saving || availLoading || noCupo}
              onClick={() =>
                void (mode === "reagendar" ? handleReagendar() : handleBook())
              }
            >
              {saving
                ? "Guardando…"
                : mode === "reagendar"
                  ? "Confirmar reagenda"
                  : "Confirmar cita"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => setMode("idle")}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {mode === "idle" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {canAgendar ? (
            <Button
              type="button"
              disabled={saving}
              onClick={() => {
                setMode("book");
                setError(null);
                setSuccess(null);
              }}
            >
              {requirement.status === "rebook_required"
                ? "Reagendar inscripción"
                : "Agendar inscripción"}
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setMode("reagendar");
                  setError(null);
                  setSuccess(null);
                }}
              >
                Reagendar inscripción
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => void handleCancel()}
              >
                Cancelar cita
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Gate: solo monta si hay repo Supabase (card interna decide requirement). */
export function AsesorAgendaInscripcionSupabaseGate(
  props: AgendaInscripcionSupabaseCardProps,
) {
  const repo = useAgendaInscripcionRepo();
  if (!repo) return null;
  return <AgendaInscripcionSupabaseCard {...props} />;
}

// Evita tree-shake warning si se importa solo el tipo repo concreto en tests.
export type { SupabaseAgendaInscripcionRepo };
