"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { getEffectiveMockName, getEffectiveMockRole } from "@/lib/mockUser";
import {
  canAccessMesaAgendaCitasPage,
  shiftMesaAgendaDayYmd,
  todayMesaAgendaYmd,
} from "@/lib/mesaAgendaCitasUi";
import {
  AgendaHojaCrmError,
  addAgendaManual,
  cancelAgendaManual,
  fetchAgendaHojaCrm,
  saveAgendaHojaResult,
  type AgendaHojaColor,
  type AgendaHojaRow,
} from "@/domain/agenda-hoja-crm/mesa.repo";

const COLOR_OPTIONS: ReadonlyArray<{ value: AgendaHojaColor; label: string }> = [
  { value: "UNKNOWN", label: "Sin color" },
  { value: "GREEN", label: "Verde" },
  { value: "RED", label: "Rojo" },
  { value: "ORANGE", label: "Naranja" },
  { value: "OTHER", label: "Neutro" },
];

const SECTIONS = [
  { locationId: "monterrey", kind: "biometricos", label: "MONTERREY · BIOMÉTRICOS" },
  { locationId: "apodaca", kind: "biometricos", label: "APODACA · BIOMÉTRICOS" },
  { locationId: "monterrey", kind: "firmas", label: "MONTERREY · FIRMAS" },
  { locationId: "apodaca", kind: "firmas", label: "APODACA · FIRMAS" },
  { locationId: "monterrey", kind: "inscripcion", label: "MONTERREY · INSCRIPCIÓN" },
] as const;

function cellTone(color: AgendaHojaColor): string {
  if (color === "GREEN") return "bg-emerald-100/90 border-emerald-300";
  if (color === "RED") return "bg-red-100/90 border-red-300";
  if (color === "ORANGE") return "bg-orange-100/90 border-orange-300";
  if (color === "OTHER") return "bg-slate-100 border-slate-300";
  return "bg-white border-slate-200";
}

function originTone(origin: string): string {
  if (origin === "Manual CRM") return "bg-indigo-50 text-indigo-800 border-indigo-200";
  if (origin === "Manual Drive") return "bg-amber-50 text-amber-800 border-amber-200";
  if (origin === "Disponible") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  return "bg-sky-50 text-sky-800 border-sky-200";
}

type RowDraft = {
  biometricResultRaw: string;
  biometricColor: AgendaHojaColor;
  notificationResultRaw: string;
  notificationColor: AgendaHojaColor;
  signatureResultRaw: string;
  signatureColor: AgendaHojaColor;
  notesRaw: string;
};

function draftFromRow(row: AgendaHojaRow): RowDraft {
  return {
    biometricResultRaw: row.biometricResultRaw,
    biometricColor: row.biometricColor,
    notificationResultRaw: row.notificationResultRaw,
    notificationColor: row.notificationColor,
    signatureResultRaw: row.signatureResultRaw,
    signatureColor: row.signatureColor,
    notesRaw: row.notesRaw,
  };
}

function ResultCell({
  value,
  color,
  label,
  disabled,
  onValueChange,
  onColorChange,
}: Readonly<{
  value: string;
  color: AgendaHojaColor;
  label: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  onColorChange: (value: AgendaHojaColor) => void;
}>) {
  return (
    <div className={`min-w-[160px] border ${cellTone(color)} p-1.5`}>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        aria-label={`${label} resultado`}
        placeholder="Escribir…"
        className="w-full bg-transparent px-1 py-1 text-xs font-medium text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-default"
      />
      <select
        value={color}
        disabled={disabled}
        onChange={(e) => onColorChange(e.target.value as AgendaHojaColor)}
        aria-label={`${label} color`}
        className="mt-1 w-full rounded border border-black/10 bg-white/70 px-1 py-0.5 text-[10px] text-slate-600 outline-none disabled:opacity-60"
      >
        {COLOR_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function EditableAgendaRow({
  row,
  onReload,
  onAddManual,
}: Readonly<{
  row: AgendaHojaRow;
  onReload: () => Promise<void>;
  onAddManual: (row: AgendaHojaRow) => void;
}>) {
  const [draft, setDraft] = useState<RowDraft>(() => draftFromRow(row));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(draftFromRow(row));
  }, [row]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFromRow(row)),
    [draft, row],
  );

  const handleSave = async () => {
    if (!row.editable || !dirty || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveAgendaHojaResult({
        rowSource: row.rowSource,
        rowId: row.rowId,
        ...draft,
      });
      setMessage("Guardado");
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelManual = async () => {
    if (!row.manualOccupancyId || row.originLabel !== "Manual CRM" || saving) return;
    if (typeof window !== "undefined" && !window.confirm("¿Liberar esta captura manual del CRM?")) return;
    setSaving(true);
    setMessage(null);
    try {
      await cancelAgendaManual(row.manualOccupancyId);
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo liberar la fila.");
    } finally {
      setSaving(false);
    }
  };

  if (row.available) {
    return (
      <tr className="border-b border-slate-200 bg-white hover:bg-slate-50/70">
        <td className="whitespace-nowrap border-r border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800">
          {row.displayTime}
        </td>
        <td colSpan={3} className="border-r border-slate-200 px-3 py-2 text-xs text-slate-400">
          Lugar disponible
        </td>
        <td colSpan={4} className="border-r border-slate-200 px-3 py-2 text-xs text-slate-400">
          —
        </td>
        <td className="px-2 py-2 text-center">
          <button
            type="button"
            onClick={() => onAddManual(row)}
            className="whitespace-nowrap rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
          >
            + Captura manual
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-200 align-top bg-white hover:bg-slate-50/40">
      <td className="whitespace-nowrap border-r border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900">
        {row.displayTime}
        {row.logicalTime !== row.displayTime ? (
          <span className="mt-0.5 block text-[9px] font-normal text-slate-400">CRM {row.logicalTime}</span>
        ) : null}
      </td>
      <td className="min-w-[125px] border-r border-slate-200 px-2 py-2 text-xs text-slate-800">
        {row.nss || "—"}
      </td>
      <td className="min-w-[220px] border-r border-slate-200 px-2 py-2 text-xs font-medium text-slate-900">
        {row.expedienteId ? (
          <Link href={`/mesa-control/${row.expedienteId}`} className="hover:underline">
            {row.clienteNombre || "Cliente"}
          </Link>
        ) : (
          row.clienteNombre || "—"
        )}
      </td>
      <td className="min-w-[160px] border-r border-slate-200 px-2 py-2 text-xs text-slate-700">
        {row.asesorNombre || "—"}
      </td>
      <td className="p-0">
        <ResultCell
          value={draft.biometricResultRaw}
          color={draft.biometricColor}
          label="Biométricos"
          disabled={!row.editable || saving}
          onValueChange={(value) => setDraft((prev) => ({ ...prev, biometricResultRaw: value }))}
          onColorChange={(value) => setDraft((prev) => ({ ...prev, biometricColor: value }))}
        />
      </td>
      <td className="p-0">
        <ResultCell
          value={draft.notificationResultRaw}
          color={draft.notificationColor}
          label="Notificación"
          disabled={!row.editable || saving}
          onValueChange={(value) => setDraft((prev) => ({ ...prev, notificationResultRaw: value }))}
          onColorChange={(value) => setDraft((prev) => ({ ...prev, notificationColor: value }))}
        />
      </td>
      <td className="p-0">
        <ResultCell
          value={draft.signatureResultRaw}
          color={draft.signatureColor}
          label="Firma"
          disabled={!row.editable || saving}
          onValueChange={(value) => setDraft((prev) => ({ ...prev, signatureResultRaw: value }))}
          onColorChange={(value) => setDraft((prev) => ({ ...prev, signatureColor: value }))}
        />
      </td>
      <td className="min-w-[220px] border-r border-slate-200 p-1.5">
        <textarea
          value={draft.notesRaw}
          disabled={!row.editable || saving}
          onChange={(e) => setDraft((prev) => ({ ...prev, notesRaw: e.target.value }))}
          aria-label="Notas operativas"
          placeholder="Notas…"
          rows={3}
          className="w-full resize-none rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-400"
        />
      </td>
      <td className="min-w-[145px] px-2 py-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${originTone(row.originLabel)}`}>
          {row.originLabel}
        </span>
        {row.crmOverride ? (
          <span className="mt-1 block text-[9px] font-medium text-indigo-600">Edición CRM</span>
        ) : null}
        {row.sheetRow ? (
          <span className="mt-1 block text-[9px] text-slate-400">Fila Drive {row.sheetRow}</span>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
            className="rounded border border-slate-300 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          {row.originLabel === "Manual CRM" && row.manualOccupancyId ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCancelManual()}
              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 disabled:opacity-40"
            >
              Liberar
            </button>
          ) : null}
        </div>
        {message ? (
          <span className={`mt-1 block text-[9px] ${message === "Guardado" ? "text-emerald-700" : "text-red-700"}`}>
            {message}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

type ManualTarget = Pick<AgendaHojaRow, "bookingDate" | "logicalTime" | "displayTime" | "kind" | "locationId">;

function ManualCapturePanel({
  target,
  saving,
  error,
  onClose,
  onSubmit,
}: Readonly<{
  target: ManualTarget;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { nss: string; clienteNombre: string; asesorNombre: string; notes: string }) => Promise<void>;
}>) {
  const [nss, setNss] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [asesorNombre, setAsesorNombre] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-indigo-950">Captura manual CRM</h2>
          <p className="text-xs text-indigo-700">
            {target.bookingDate} · {target.displayTime} · {target.locationId} · {target.kind}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs font-semibold text-indigo-700 hover:underline">
          Cerrar
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="text-xs font-medium text-slate-700">
          NSS
          <input value={nss} onChange={(e) => setNss(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-700 md:col-span-2">
          Cliente *
          <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Asesor
          <input value={asesorNombre} onChange={(e) => setAsesorNombre(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-700 md:col-span-4">
          Notas
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-red-700">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          disabled={saving || !clienteNombre.trim()}
          onClick={() => void onSubmit({ nss, clienteNombre, asesorNombre, notes })}
        >
          {saving ? "Guardando…" : "Ocupar lugar"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
          Cancelar
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-indigo-700">
        Esta captura consume cupo, pero no crea una cita operativa ni cambia la etapa del expediente.
      </p>
    </section>
  );
}

export function MesaAgendaHojaOperativaClient() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const [selectedDate, setSelectedDate] = useState(() => todayMesaAgendaYmd());
  const [rows, setRows] = useState<AgendaHojaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualTarget, setManualTarget] = useState<ManualTarget | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const mockRole = getEffectiveMockRole();
  const canAccess =
    canAccessMesaAgendaCitasPage(mockRole) || canAccessMesaAgendaCitasPage(currentUser?.role ?? null);

  const loadRows = useCallback(async () => {
    if (!currentUser || !canAccess) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAgendaHojaCrm(selectedDate));
    } catch (err) {
      setError(err instanceof AgendaHojaCrmError || err instanceof Error ? err.message : "No se pudo cargar la hoja operativa.");
    } finally {
      setLoading(false);
    }
  }, [canAccess, currentUser, selectedDate]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        rows: rows.filter((row) => row.locationId === section.locationId && row.kind === section.kind),
      })).filter((section) => section.rows.length > 0),
    [rows],
  );

  const occupied = rows.filter((row) => !row.available).length;
  const available = rows.filter((row) => row.available).length;
  const manualCrm = rows.filter((row) => row.originLabel === "Manual CRM").length;

  const handleManualSubmit = async (input: { nss: string; clienteNombre: string; asesorNombre: string; notes: string }) => {
    if (!manualTarget) return;
    setManualSaving(true);
    setManualError(null);
    try {
      await addAgendaManual({
        ...manualTarget,
        ...input,
      });
      setManualTarget(null);
      await loadRows();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "No se pudo ocupar el lugar.");
    } finally {
      setManualSaving(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Link href="/login" className="text-sm text-blue-600 underline">Inicia sesión</Link>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No tienes permiso para consultar la hoja operativa de citas.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">Mesa de control</h1>
            <p className="text-xs text-slate-500">Hoja operativa de citas · ConCasa CRM</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[220px] flex-col truncate text-right text-xs text-slate-500 sm:flex">
              <span className="truncate font-medium text-slate-700">{getEffectiveMockName() || currentUser.email}</span>
              <span className="truncate text-[10px] text-slate-400">{currentUser.email}</span>
            </span>
            <NotificationsBell notifications={[]} />
            <Button
              variant="outline"
              className="text-xs sm:text-sm"
              onClick={async () => {
                try {
                  await sessionRepo.logout();
                } catch (err) {
                  console.error("[logout] agenda-hoja-crm:", err);
                }
                if (typeof window !== "undefined") {
                  window.localStorage.removeItem("mock_role");
                  window.localStorage.removeItem("mock_email");
                  window.location.href = "/login";
                }
              }}
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/mesa-control/citas" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              ← Volver a Agenda de citas
            </Link>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">Vista tipo Drive</h2>
            <p className="text-sm text-slate-500">La agenda visual del equipo, dentro del CRM.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setSelectedDate((d) => shiftMesaAgendaDayYmd(d, -1))}>← Día</Button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
            <Button type="button" variant="outline" onClick={() => setSelectedDate((d) => shiftMesaAgendaDayYmd(d, 1))}>Día →</Button>
            <Button type="button" variant="outline" onClick={() => setSelectedDate(todayMesaAgendaYmd())}>Hoy</Button>
            <Button type="button" disabled={loading} onClick={() => void loadRows()}>{loading ? "Actualizando…" : "Actualizar"}</Button>
          </div>
        </div>

        <section className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-semibold">Drive sigue activo para las citas.</p>
          <p className="mt-1 text-xs text-sky-800">
            Las citas normales continúan sincronizándose con Google. Resultados, colores, notas y capturas manuales que hagas aquí se guardan en CRM y no cambian etapas automáticamente.
          </p>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><p className="text-xs text-slate-500">Ocupados</p><p className="text-2xl font-semibold text-slate-900">{occupied}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><p className="text-xs text-slate-500">Disponibles</p><p className="text-2xl font-semibold text-emerald-700">{available}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><p className="text-xs text-slate-500">Manuales CRM</p><p className="text-2xl font-semibold text-indigo-700">{manualCrm}</p></div>
        </div>

        {manualTarget ? (
          <ManualCapturePanel
            key={`${manualTarget.bookingDate}-${manualTarget.kind}-${manualTarget.locationId}-${manualTarget.logicalTime}`}
            target={manualTarget}
            saving={manualSaving}
            error={manualError}
            onClose={() => { setManualTarget(null); setManualError(null); }}
            onSubmit={handleManualSubmit}
          />
        ) : null}

        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
        ) : null}
        {loading && rows.length === 0 ? <p className="text-sm text-slate-600">Cargando hoja operativa…</p> : null}

        {!loading && !error && sections.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">No hay filas de agenda para esta fecha.</p>
        ) : null}

        {sections.map((section) => (
          <section key={`${section.locationId}-${section.kind}`} className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
            <div className="border-b border-slate-300 bg-slate-900 px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold tracking-wide text-white">{section.label}</h3>
                <span className="text-[11px] font-medium text-slate-300">{section.rows.filter((r) => !r.available).length} ocupados · {section.rows.filter((r) => r.available).length} libres</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1420px] border-collapse text-left">
                <thead className="bg-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="border-r border-slate-200 px-3 py-2">Hora</th>
                    <th className="border-r border-slate-200 px-2 py-2">NSS</th>
                    <th className="border-r border-slate-200 px-2 py-2">Cliente</th>
                    <th className="border-r border-slate-200 px-2 py-2">Asesor</th>
                    <th className="border-r border-slate-200 px-2 py-2">Biométricos</th>
                    <th className="border-r border-slate-200 px-2 py-2">Notificación</th>
                    <th className="border-r border-slate-200 px-2 py-2">Firma</th>
                    <th className="border-r border-slate-200 px-2 py-2">Notas</th>
                    <th className="px-2 py-2">Origen / acción</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <EditableAgendaRow
                      key={`${row.rowSource}-${row.rowId}`}
                      row={row}
                      onReload={loadRows}
                      onAddManual={(availableRow) => {
                        setManualError(null);
                        setManualTarget({
                          bookingDate: availableRow.bookingDate,
                          logicalTime: availableRow.logicalTime,
                          displayTime: availableRow.displayTime,
                          kind: availableRow.kind,
                          locationId: availableRow.locationId,
                        });
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
