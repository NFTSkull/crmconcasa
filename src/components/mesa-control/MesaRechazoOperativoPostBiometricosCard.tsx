"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  biometricosCondicionSchema,
  type BiometricosCondicion,
  useExpedientesRepo,
} from "@/domain/expedientes";
import { fetchMesaAgendaBookings } from "@/domain/agenda-calendar/mesa.repo";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";

type Props = {
  expedienteId: string;
  etapaActual: number | null;
  subestado: string | null;
  cicloEstado: string | null;
  submittedToMesa: boolean;
  fechaCita: string | null;
  dataModeSupabase: boolean;
  onUpdated: () => void;
};

function fechaLocalMx(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", {
    timeZone: "America/Monterrey",
  });
}

function bookingLabel(booking: MesaAgendaBookingEntry): string {
  const estado =
    booking.status === "booked" ? "Agendada" : "Cancelada después";
  return `${booking.bookingDate} ${booking.bookingTime.slice(0, 5)} · ${estado}`;
}

export function MesaRechazoOperativoPostBiometricosCard({
  expedienteId,
  etapaActual,
  subestado,
  cicloEstado,
  submittedToMesa,
  fechaCita,
  dataModeSupabase,
  onUpdated,
}: Props) {
  const repo = useExpedientesRepo();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [comentario, setComentario] = useState("");
  const [condicion, setCondicion] =
    useState<BiometricosCondicion>("desconocida");
  const [razon, setRazon] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [bookings, setBookings] = useState<MesaAgendaBookingEntry[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible =
    dataModeSupabase &&
    submittedToMesa &&
    cicloEstado === "activo" &&
    subestado !== "rechazado" &&
    (etapaActual === 5 || etapaActual === 6);

  useEffect(() => {
    if (!visible || !open || !fechaCita) return;
    const date = fechaLocalMx(fechaCita);
    if (!date) return;
    let cancelled = false;
    setLoadingBookings(true);
    setError(null);
    void fetchMesaAgendaBookings({
      startDate: date,
      endDate: date,
      includeCancelled: true,
      kind: "biometricos",
    })
      .then((rows) => {
        if (cancelled) return;
        setBookings(
          rows.filter(
            (row) =>
              row.expedienteId === expedienteId &&
              (row.status === "booked" || row.status === "cancelled"),
          ),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "No se pudo cargar la evidencia biométrica.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBookings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expedienteId, fechaCita, open, visible]);

  const requiereIntento = useMemo(
    () => ["reutilizables", "repetir", "invalidos"].includes(condicion),
    [condicion],
  );

  if (!visible) return null;

  const guardar = async () => {
    setSaving(true);
    setError(null);
    try {
      await repo.rechazarEtapaOperativa(expedienteId, {
        motivo,
        comentario: comentario || null,
        biometricosCondicion: biometricosCondicionSchema.parse(condicion),
        biometricosRazon: razon || null,
        biometricosBookingId: bookingId || null,
      });
      setOpen(false);
      onUpdated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo registrar el rechazo operativo.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/50 p-4">
      <h2 className="text-sm font-semibold text-red-950">
        Rechazo operativo post-biométricos
      </h2>
      <p className="mt-1 text-xs text-red-900">
        Registra la decisión humana sobre los biométricos sin cancelar ni
        alterar la cita histórica.
      </p>
      {!open ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 border-red-300 text-red-800"
          onClick={() => setOpen(true)}
        >
          Rechazar etapa y clasificar biométricos
        </Button>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-800">
            Motivo del rechazo
            <input
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-gray-800">
            Condición biométrica
            <select
              value={condicion}
              onChange={(event) =>
                setCondicion(
                  biometricosCondicionSchema.parse(event.target.value),
                )
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="desconocida">Desconocida</option>
              <option value="no_completados">No completados</option>
              <option value="reutilizables">Reutilizables</option>
              <option value="repetir">Repetir</option>
              <option value="invalidos">Inválidos</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-800 sm:col-span-2">
            Comentario operativo
            <textarea
              value={comentario}
              onChange={(event) => setComentario(event.target.value)}
              className="mt-1 min-h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-gray-800">
            Booking biométrico de referencia
            <select
              value={bookingId}
              onChange={(event) => setBookingId(event.target.value)}
              disabled={loadingBookings}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Sin booking</option>
              {bookings.map((booking) => (
                <option key={booking.bookingId} value={booking.bookingId}>
                  {bookingLabel(booking)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-800">
            Razón biométrica
            <input
              value={razon}
              onChange={(event) => setRazon(event.target.value)}
              placeholder={
                requiereIntento ? "Obligatoria para esta condición" : "Opcional"
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-800 sm:col-span-2"
            >
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="primary"
              className="bg-red-700 hover:bg-red-800 focus:ring-red-600"
              disabled={
                saving ||
                !motivo.trim() ||
                (requiereIntento && (!bookingId || !razon.trim()))
              }
              onClick={() => void guardar()}
            >
              {saving ? "Registrando…" : "Confirmar rechazo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
