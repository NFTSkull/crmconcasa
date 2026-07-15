"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaFirmasSupabaseError,
  buildScheduledAtIso,
  useAgendaFirmasBookingRepo,
  type AgendaFirmasActiveBooking,
  type AgendaFirmasConfigRecord,
} from "@/domain/agenda-firmas";

type Props = Readonly<{
  expedienteId: string;
  etapaActual: number;
  activeBooking: AgendaFirmasActiveBooking | null;
  config: AgendaFirmasConfigRecord | null;
  onRefresh: () => void;
  onRequestCancel: () => void;
}>;

export function MesaGestionFirmasSection({
  expedienteId,
  etapaActual,
  activeBooking,
  config,
  onRefresh,
  onRequestCancel,
}: Props) {
  const repo = useAgendaFirmasBookingRepo();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canCreate = etapaActual === 9 || etapaActual === 10;
  const enabledLocations = useMemo(
    () => config?.config.locations.filter((location) => location.enabled) ?? [],
    [config],
  );
  const canSubmit =
    Boolean(repo && config?.config.enabled && date && time && locationId) &&
    !saving;

  if (!activeBooking && !canCreate) return null;

  async function getBookingAt(): Promise<string> {
    if (!config) throw new Error("La agenda de firmas no está configurada.");
    return buildScheduledAtIso(
      date as `${number}-${number}-${number}`,
      time as `${number}:${number}`,
      config.config.timezone,
    );
  }

  async function handleBook() {
    if (!repo || !config || !canSubmit || activeBooking) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await repo.mesaBookFirmas({
        expedienteId,
        bookingAt: await getBookingAt(),
        timezone: config.config.timezone,
        locationId,
        nota: note.trim() || null,
      });
      setSuccess("Cita de firma agendada por Mesa.");
      onRefresh();
    } catch (err) {
      setError(
        err instanceof AgendaFirmasSupabaseError || err instanceof Error
          ? err.message
          : "No se pudo agendar la firma.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReagendar() {
    if (!repo || !config || !canSubmit || !activeBooking || !reason.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await repo.mesaReagendarFirmas({
        expedienteId,
        bookingAt: await getBookingAt(),
        timezone: config.config.timezone,
        locationId,
        motivo: reason.trim(),
      });
      setSuccess("Cita de firma reagendada por Mesa.");
      setReason("");
      onRefresh();
    } catch (err) {
      setError(
        err instanceof AgendaFirmasSupabaseError || err instanceof Error
          ? err.message
          : "No se pudo reagendar la firma.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
      <h2 className="text-base font-semibold text-violet-950">
        Gestión de firmas por Mesa
      </h2>

      {!canCreate && activeBooking ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Existe un booking de firmas activo fuera de las etapas 9/10. El
          movimiento manual no lo canceló. Puedes cancelarlo explícitamente.
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            onClick={onRequestCancel}
          >
            Cancelar firma explícitamente
          </Button>
        </div>
      ) : null}

      {canCreate ? (
        <>
          <p className="mt-1 text-xs text-violet-900">
            Agendar o reagendar no cambia la etapa del expediente.
          </p>

          {activeBooking ? (
            <div className="mt-3 rounded-md border border-violet-200 bg-white p-3 text-sm">
              <p className="font-medium">Booking activo</p>
              <p className="mt-1 text-xs text-gray-600">
                {activeBooking.bookingDate} · {activeBooking.bookingTime} ·{" "}
                {activeBooking.locationId}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                onClick={onRequestCancel}
              >
                Cancelar firma
              </Button>
            </div>
          ) : null}

          {!config?.config.enabled ? (
            <p className="mt-3 text-sm text-amber-800">
              La agenda de firmas no está configurada o está deshabilitada.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-medium text-gray-800">
                Fecha
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                  value={date}
                  disabled={saving}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium text-gray-800">
                Hora
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                  value={time}
                  disabled={saving}
                  onChange={(event) => setTime(event.target.value)}
                >
                  <option value="">Selecciona</option>
                  {config.config.slots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-gray-800">
                Sede
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                  value={locationId}
                  disabled={saving}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  <option value="">Selecciona</option>
                  {enabledLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {activeBooking ? (
            <label className="mt-3 block text-sm font-medium text-gray-800">
              Motivo de reagenda
              <input
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                value={reason}
                disabled={saving}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : (
            <label className="mt-3 block text-sm font-medium text-gray-800">
              Nota opcional
              <input
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                value={note}
                disabled={saving}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          )}

          <Button
            type="button"
            className="mt-3"
            disabled={
              !canSubmit || (activeBooking != null && reason.trim().length === 0)
            }
            onClick={() =>
              void (activeBooking ? handleReagendar() : handleBook())
            }
          >
            {saving
              ? "Guardando…"
              : activeBooking
                ? "Reagendar firmas"
                : "Agendar firmas"}
          </Button>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="mt-3 text-sm text-green-700">
          {success}
        </p>
      ) : null}
    </section>
  );
}
