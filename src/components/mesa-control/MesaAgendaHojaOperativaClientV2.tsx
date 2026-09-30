"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
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

const COLOR_ACTIONS: ReadonlyArray<{
  value: AgendaHojaColor;
  label: string;
  symbol: string;
  inactive: string;
  active: string;
}> = [
  {
    value: "GREEN",
    label: "Verde / correcto",
    symbol: "✓",
    inactive: "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50",
    active: "border-emerald-600 bg-emerald-600 text-white shadow-sm",
  },
  {
    value: "RED",
    label: "Rojo / incidencia",
    symbol: "×",
    inactive: "border-red-200 bg-white text-red-700 hover:bg-red-50",
    active: "border-red-600 bg-red-600 text-white shadow-sm",
  },
  {
    value: "ORANGE",
    label: "Naranja / pendiente",
    symbol: "!",
    inactive: "border-orange-200 bg-white text-orange-700 hover:bg-orange-50",
    active: "border-orange-500 bg-orange-500 text-white shadow-sm",
  },
  {
    value: "OTHER",
    label: "Neutro",
    symbol: "•",
    inactive: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
    active: "border-slate-500 bg-slate-500 text-white shadow-sm",
  },
  {
    value: "UNKNOWN",
    label: "Sin color",
    symbol: "○",
    inactive: "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
    active: "border-slate-400 bg-slate-100 text-slate-700 shadow-sm",
  },
];

const SECTIONS = [
  { locationId: "monterrey", kind: "biometricos", label: "MONTERREY · BIOMÉTRICOS", short: "MTY Biométricos" },
  { locationId: "leo", kind: "biometricos", label: "LEO / HACER PAGARÉS", short: "LEO / Hacer pagarés" },
  { locationId: "apodaca", kind: "biometricos", label: "APODACA · BIOMÉTRICOS", short: "Apodaca Biométricos" },
  { locationId: "monterrey", kind: "firmas", label: "MONTERREY · FIRMAS", short: "MTY Firmas" },
  { locationId: "apodaca", kind: "firmas", label: "APODACA · FIRMAS", short: "Apodaca Firmas" },
  { locationId: "monterrey", kind: "inscripcion", label: "MONTERREY · INSCRIPCIÓN", short: "Inscripción" },
] as const;

type FilterMode = "all" | "pending" | "alerts" | "available" | "manual";
type SectionFilter = "all" | string;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function cellTone(color: AgendaHojaColor): string {
  if (color === "GREEN") return "border-emerald-300 bg-emerald-50";
  if (color === "RED") return "border-red-300 bg-red-50";
  if (color === "ORANGE") return "border-orange-300 bg-orange-50";
  if (color === "OTHER") return "border-slate-300 bg-slate-50";
  return "border-slate-200 bg-white";
}

function originTone(origin: string): string {
  if (origin === "Manual CRM") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  if (origin === "Manual Drive") return "border-amber-200 bg-amber-50 text-amber-800";
  if (origin.startsWith("LEO")) return "border-orange-300 bg-orange-50 text-orange-800";
  if (origin === "Disponible") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function sectionTone(kind: string): string {
  if (kind === "firmas") return "bg-violet-950";
  if (kind === "inscripcion") return "bg-teal-800";
  return "bg-fuchsia-800";
}

function rowHasAlert(row: AgendaHojaRow): boolean {
  return (
    row.biometricColor === "RED" ||
    row.notificationColor === "RED" ||
    row.signatureColor === "RED"
  );
}

function rowHasResult(row: AgendaHojaRow): boolean {
  return Boolean(
    row.biometricResultRaw.trim() ||
      row.notificationResultRaw.trim() ||
      row.signatureResultRaw.trim(),
  );
}

function rowMatchesFilter(row: AgendaHojaRow, filter: FilterMode): boolean {
  if (filter === "pending") return !row.available && !rowHasResult(row);
  if (filter === "alerts") return !row.available && rowHasAlert(row);
  if (filter === "available") return row.available;
  if (filter === "manual") return row.originLabel === "Manual CRM";
  return true;
}

function formatDateLong(ymd: string): string {
  const date = new Date(ymd + "T12:00:00");
  if (Number.isNaN(date.getTime())) return ymd;
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatDateChip(ymd: string): { weekday: string; day: string } {
  const date = new Date(ymd + "T12:00:00");
  if (Number.isNaN(date.getTime())) return { weekday: "", day: ymd };
  return {
    weekday: new Intl.DateTimeFormat("es-MX", { weekday: "short" })
      .format(date)
      .replace(".", "")
      .toUpperCase(),
    day: new Intl.DateTimeFormat("es-MX", { day: "2-digit" }).format(date),
  };
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalize(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result.slice(0, 15);
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
  listId,
  suggestions,
  disabled,
  compact,
  onValueChange,
  onColorChange,
  onShortcut,
}: Readonly<{
  value: string;
  color: AgendaHojaColor;
  label: string;
  listId: string;
  suggestions: string[];
  disabled: boolean;
  compact: boolean;
  onValueChange: (value: string) => void;
  onColorChange: (value: AgendaHojaColor) => void;
  onShortcut: (event: KeyboardEvent<HTMLElement>) => void;
}>) {
  return (
    <div
      className={cx(
        "min-w-[178px] border transition-colors",
        compact ? "p-1" : "p-1.5",
        cellTone(color),
      )}
    >
      <input
        value={value}
        list={listId}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => onShortcut(event)}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={label + " resultado"}
        placeholder="Escribir resultado…"
        className={cx(
          "w-full rounded border border-transparent bg-transparent px-1.5 font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-slate-300 focus:bg-white/80 disabled:cursor-default",
          compact ? "py-1 text-[11px]" : "py-1.5 text-xs",
        )}
      />
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <div className="mt-1 flex items-center gap-1" aria-label={label + " color"}>
        {COLOR_ACTIONS.map((action) => (
          <button
            key={action.value}
            type="button"
            disabled={disabled}
            onClick={() => onColorChange(action.value)}
            title={action.label}
            aria-label={label + ": " + action.label}
            className={cx(
              "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black transition disabled:cursor-default disabled:opacity-60",
              color === action.value ? action.active : action.inactive,
            )}
          >
            {action.symbol}
          </button>
        ))}
        <span className="ml-1 truncate text-[9px] font-medium text-slate-500">
          {COLOR_ACTIONS.find((item) => item.value === color)?.label || "Sin color"}
        </span>
      </div>
    </div>
  );
}

function EditableAgendaRow({
  row,
  compact,
  suggestions,
  onReload,
  onAddManual,
}: Readonly<{
  row: AgendaHojaRow;
  compact: boolean;
  suggestions: {
    biometricos: string[];
    notificacion: string[];
    firma: string[];
  };
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

  const alert = rowHasAlert(row);
  const stickyTone = alert ? "bg-red-50" : dirty ? "bg-amber-50" : "bg-white";

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

  const handleShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSave();
    }
  };

  const handleCancelManual = async () => {
    if (!row.manualOccupancyId || row.originLabel !== "Manual CRM" || saving) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("¿Liberar esta captura manual del CRM?")
    ) {
      return;
    }
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
      <tr className="group border-b border-slate-200 bg-white hover:bg-emerald-50/40">
        <td
          className="sticky left-0 z-10 w-[78px] border-r border-slate-200 bg-white px-2 py-2 text-center text-xs font-bold text-slate-700 group-hover:bg-emerald-50"
        >
          {row.displayTime}
        </td>
        <td
          className="sticky left-[78px] z-10 w-[128px] border-r border-slate-200 bg-white px-2 py-2 text-xs text-slate-300 group-hover:bg-emerald-50"
        >
          —
        </td>
        <td
          className="sticky left-[206px] z-10 w-[244px] border-r border-slate-200 bg-white px-3 py-2 group-hover:bg-emerald-50"
        >
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Lugar disponible
          </span>
        </td>
        <td
          className="sticky left-[450px] z-10 w-[190px] border-r border-slate-200 bg-white px-2 py-2 text-xs text-slate-300 group-hover:bg-emerald-50"
        >
          —
        </td>
        <td colSpan={row.kind === "biometricos" ? 3 : 4} className="border-r border-slate-200 px-3 py-2 text-xs text-slate-400">
          Espacio libre en la hoja.
        </td>
        <td className="min-w-[150px] px-2 py-2 text-center">
          <button
            type="button"
            onClick={() => onAddManual(row)}
            className="whitespace-nowrap rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800 transition hover:border-indigo-300 hover:bg-indigo-100"
          >
            + Captura manual
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={cx(
        "group border-b border-slate-200 align-top transition-colors",
        alert
          ? "bg-red-50/70 hover:bg-red-50"
          : dirty
            ? "bg-amber-50/60 hover:bg-amber-50"
            : "bg-white hover:bg-slate-50/70",
      )}
    >
      <td
        className={cx(
          "sticky left-0 z-10 w-[78px] border-r border-slate-200 px-2 text-center text-xs font-black text-slate-900",
          compact ? "py-2" : "py-3",
          stickyTone,
        )}
      >
        {row.displayTime}
        {row.logicalTime !== row.displayTime ? (
          <span className="mt-0.5 block text-[9px] font-medium text-slate-400">
            CRM {row.logicalTime}
          </span>
        ) : null}
        {row.sheetRow ? (
          <span className="mt-1 block text-[9px] font-normal text-slate-400">
            Fila {row.sheetRow}
          </span>
        ) : null}
      </td>
      <td
        className={cx(
          "sticky left-[78px] z-10 w-[128px] border-r border-slate-200 px-2 font-mono text-[11px] font-semibold text-slate-700",
          compact ? "py-2" : "py-3",
          stickyTone,
        )}
      >
        {row.nss || "—"}
      </td>
      <td
        className={cx(
          "sticky left-[206px] z-10 w-[244px] border-r border-slate-200 px-3 text-xs font-bold text-slate-950",
          compact ? "py-2" : "py-3",
          stickyTone,
        )}
      >
        {row.expedienteId ? (
          <Link
            href={"/mesa-control/" + row.expedienteId}
            className="leading-4 hover:text-indigo-700 hover:underline"
          >
            {row.clienteNombre || "Cliente"}
          </Link>
        ) : (
          <span className="leading-4">{row.clienteNombre || "—"}</span>
        )}
        {alert ? (
          <span className="mt-1 flex w-fit items-center gap-1 rounded-full border border-red-200 bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">
            ⚠ Incidencia
          </span>
        ) : null}
      </td>
      <td
        className={cx(
          "sticky left-[450px] z-10 w-[190px] border-r border-slate-200 px-2 text-[11px] font-semibold text-slate-700",
          compact ? "py-2" : "py-3",
          stickyTone,
        )}
      >
        {row.asesorNombre || "—"}
      </td>
      <td className="p-0">
        <ResultCell
          value={draft.biometricResultRaw}
          color={draft.biometricColor}
          label="Biométricos"
          listId={"bio-" + row.rowId}
          suggestions={suggestions.biometricos}
          disabled={!row.editable || saving}
          compact={compact}
          onValueChange={(value) =>
            setDraft((prev) => ({ ...prev, biometricResultRaw: value }))
          }
          onColorChange={(value) =>
            setDraft((prev) => ({ ...prev, biometricColor: value }))
          }
          onShortcut={handleShortcut}
        />
      </td>
      <td className="p-0">
        <ResultCell
          value={draft.notificationResultRaw}
          color={draft.notificationColor}
          label="Notificación"
          listId={"notif-" + row.rowId}
          suggestions={suggestions.notificacion}
          disabled={!row.editable || saving}
          compact={compact}
          onValueChange={(value) =>
            setDraft((prev) => ({ ...prev, notificationResultRaw: value }))
          }
          onColorChange={(value) =>
            setDraft((prev) => ({ ...prev, notificationColor: value }))
          }
          onShortcut={handleShortcut}
        />
      </td>
      {row.kind !== "biometricos" ? (
        <td className="p-0">
          <ResultCell
            value={draft.signatureResultRaw}
            color={draft.signatureColor}
            label={row.kind === "firmas" ? "Firmó / Firma" : "Firma"}
            listId={"firma-" + row.rowId}
            suggestions={suggestions.firma}
            disabled={!row.editable || saving}
            compact={compact}
            onValueChange={(value) =>
              setDraft((prev) => ({ ...prev, signatureResultRaw: value }))
            }
            onColorChange={(value) =>
              setDraft((prev) => ({ ...prev, signatureColor: value }))
            }
            onShortcut={handleShortcut}
          />
        </td>
      ) : null}
      <td className={cx("min-w-[235px] border-r border-slate-200 p-1.5", alert && "bg-red-50/40")}>
        <textarea
          value={draft.notesRaw}
          disabled={!row.editable || saving}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, notesRaw: event.target.value }))
          }
          onKeyDown={(event) => handleShortcut(event)}
          aria-label="Notas operativas"
          placeholder="Notas operativas…"
          rows={compact ? 2 : 3}
          className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] leading-4 text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        />
      </td>
      <td className={cx("min-w-[155px] px-2", compact ? "py-2" : "py-3")}>
        <span
          className={cx(
            "inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold",
            originTone(row.originLabel),
          )}
        >
          {row.originLabel}
        </span>
        {row.crmOverride ? (
          <span className="mt-1 block text-[9px] font-bold text-indigo-600">
            Editado en CRM
          </span>
        ) : null}
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
            className={cx(
              "rounded-lg border px-2 py-1.5 text-[10px] font-bold transition",
              dirty
                ? "border-indigo-700 bg-indigo-700 text-white hover:bg-indigo-800"
                : "border-slate-200 bg-slate-100 text-slate-400",
              "disabled:cursor-not-allowed",
            )}
          >
            {saving ? "Guardando…" : dirty ? "Guardar cambios" : "Sin cambios"}
          </button>
          {dirty ? (
            <span className="text-center text-[9px] font-medium text-amber-700">
              ⌘/Ctrl + Enter
            </span>
          ) : null}
          {row.originLabel === "Manual CRM" && row.manualOccupancyId ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCancelManual()}
              className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-40"
            >
              Liberar lugar
            </button>
          ) : null}
        </div>
        {message ? (
          <span
            className={cx(
              "mt-1.5 block rounded px-1.5 py-1 text-center text-[9px] font-bold",
              message === "Guardado"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700",
            )}
          >
            {message === "Guardado" ? "✓ Guardado" : message}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

type ManualTarget = Pick<
  AgendaHojaRow,
  "bookingDate" | "logicalTime" | "displayTime" | "kind" | "locationId"
>;

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
  onSubmit: (input: {
    nss: string;
    clienteNombre: string;
    asesorNombre: string;
    notes: string;
  }) => Promise<void>;
}>) {
  const [nss, setNss] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [asesorNombre, setAsesorNombre] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Captura manual CRM"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="w-full max-w-3xl overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-indigo-100 bg-indigo-50 px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-500">
              Nuevo espacio manual
            </p>
            <h2 className="mt-1 text-lg font-bold text-indigo-950">
              Captura manual CRM
            </h2>
            <p className="mt-1 text-xs font-medium text-indigo-700">
              {target.bookingDate} · {target.displayTime} · {target.locationId.toUpperCase()} · {target.kind.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-indigo-200 bg-white text-lg font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-4">
          <label className="text-xs font-bold text-slate-700">
            NSS
            <input
              value={nss}
              onChange={(event) => setNss(event.target.value)}
              placeholder="11 dígitos"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="text-xs font-bold text-slate-700 md:col-span-2">
            Cliente *
            <input
              autoFocus
              value={clienteNombre}
              onChange={(event) => setClienteNombre(event.target.value)}
              placeholder="Nombre completo"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="text-xs font-bold text-slate-700">
            Asesor
            <input
              value={asesorNombre}
              onChange={(event) => setAsesorNombre(event.target.value)}
              placeholder="Nombre del asesor"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="text-xs font-bold text-slate-700 md:col-span-4">
            Notas
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Observación operativa"
              rows={2}
              className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
        </div>

        {error ? (
          <p
            role="alert"
            className="mx-5 mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <p className="max-w-xl text-[11px] leading-4 text-slate-500">
            Consume cupo físico, pero no crea una cita operativa falsa ni mueve la etapa del expediente.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving || !clienteNombre.trim()}
              onClick={() =>
                void onSubmit({ nss, clienteNombre, asesorNombre, notes })
              }
            >
              {saving ? "Guardando…" : "Ocupar lugar"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
}: Readonly<{
  label: string;
  value: number;
  hint: string;
  tone: "slate" | "green" | "red" | "amber" | "indigo";
  onClick?: () => void;
  active?: boolean;
}>) {
  const toneClass = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    red: "text-red-700",
    amber: "text-amber-700",
    indigo: "text-indigo-700",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition",
        onClick && "hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-200",
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={cx("text-2xl font-black", toneClass)}>{value}</p>
        <span className="text-[10px] font-medium text-slate-400">{hint}</span>
      </div>
    </button>
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
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("all");
  const [compact, setCompact] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(),
  );

  const mockRole = getEffectiveMockRole();
  const canAccess =
    canAccessMesaAgendaCitasPage(mockRole) ||
    canAccessMesaAgendaCitasPage(currentUser?.role ?? null);

  const loadRows = useCallback(async () => {
    if (!currentUser || !canAccess) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAgendaHojaCrm(selectedDate));
    } catch (err) {
      setError(
        err instanceof AgendaHojaCrmError || err instanceof Error
          ? err.message
          : "No se pudo cargar la hoja operativa.",
      );
    } finally {
      setLoading(false);
    }
  }, [canAccess, currentUser, selectedDate]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const dateStrip = useMemo(
    () =>
      [-2, -1, 0, 1, 2].map((offset) => {
        const ymd = shiftMesaAgendaDayYmd(selectedDate, offset);
        return { ymd, ...formatDateChip(ymd) };
      }),
    [selectedDate],
  );

  const occupied = rows.filter((row) => !row.available).length;
  const available = rows.filter((row) => row.available).length;
  const manualCrm = rows.filter((row) => row.originLabel === "Manual CRM").length;
  const pending = rows.filter((row) => !row.available && !rowHasResult(row)).length;
  const alerts = rows.filter((row) => !row.available && rowHasAlert(row)).length;

  const suggestions = useMemo(
    () => ({
      biometricos: uniqueValues(rows.map((row) => row.biometricResultRaw)),
      notificacion: uniqueValues(rows.map((row) => row.notificationResultRaw)),
      firma: uniqueValues(rows.map((row) => row.signatureResultRaw)),
    }),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = normalize(search);
    return rows.filter((row) => {
      const sectionKey = row.locationId + ":" + row.kind;
      if (sectionFilter !== "all" && sectionKey !== sectionFilter) return false;
      if (!rowMatchesFilter(row, filterMode)) return false;
      if (!query) return true;
      const haystack = normalize(
        [
          row.nss,
          row.clienteNombre,
          row.asesorNombre,
          row.biometricResultRaw,
          row.notificationResultRaw,
          row.signatureResultRaw,
          row.notesRaw,
          row.originLabel,
        ].join(" "),
      );
      return haystack.includes(query);
    });
  }, [filterMode, rows, search, sectionFilter]);

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => {
        const sectionRows = filteredRows.filter(
          (row) =>
            row.locationId === section.locationId && row.kind === section.kind,
        );
        return {
          ...section,
          key: section.locationId + ":" + section.kind,
          rows: sectionRows,
          occupied: sectionRows.filter((row) => !row.available).length,
          available: sectionRows.filter((row) => row.available).length,
          pending: sectionRows.filter(
            (row) => !row.available && !rowHasResult(row),
          ).length,
          alerts: sectionRows.filter(
            (row) => !row.available && rowHasAlert(row),
          ).length,
        };
      }).filter((section) => section.rows.length > 0),
    [filteredRows],
  );

  const toggleSection = (key: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const collapseAll = () => {
    setCollapsedSections(
      new Set(
        SECTIONS.map((section) => section.locationId + ":" + section.kind),
      ),
    );
  };

  const expandAll = () => {
    setCollapsedSections(new Set());
  };

  const handleManualSubmit = async (input: {
    nss: string;
    clienteNombre: string;
    asesorNombre: string;
    notes: string;
  }) => {
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
      setManualError(
        err instanceof Error ? err.message : "No se pudo ocupar el lugar.",
      );
    } finally {
      setManualSaving(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Link href="/login" className="text-sm text-blue-600 underline">
          Inicia sesión
        </Link>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          No tienes permiso para consultar la hoja operativa de citas.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-[1900px] items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              Mesa de control
            </h1>
            <p className="text-xs text-slate-500">
              Agenda operativa · vista tipo Drive
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[240px] flex-col truncate text-right text-xs text-slate-500 sm:flex">
              <span className="truncate font-bold text-slate-700">
                {getEffectiveMockName() || currentUser.email}
              </span>
              <span className="truncate text-[10px] text-slate-400">
                {currentUser.email}
              </span>
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

      <main className="mx-auto max-w-[1900px] space-y-4 px-3 py-4 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href="/mesa-control/citas"
              className="text-sm font-semibold text-slate-600 hover:text-slate-950"
            >
              ← Volver a Agenda de citas
            </Link>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-950">
                  Hoja operativa
                </h2>
                <p className="mt-0.5 text-sm font-medium capitalize text-slate-500">
                  {formatDateLong(selectedDate)}
                </p>
              </div>
              {loading ? (
                <span className="mb-0.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700">
                  Actualizando…
                </span>
              ) : (
                <span className="mb-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                  ✓ Sincronizado
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setSelectedDate((date) => shiftMesaAgendaDayYmd(date, -1))
              }
            >
              ← Día
            </Button>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setSelectedDate((date) => shiftMesaAgendaDayYmd(date, 1))
              }
            >
              Día →
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedDate(todayMesaAgendaYmd())}
            >
              Hoy
            </Button>
            <Button
              type="button"
              disabled={loading}
              onClick={() => void loadRows()}
            >
              {loading ? "Actualizando…" : "↻ Actualizar"}
            </Button>
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-2">
            {dateStrip.map((item) => (
              <button
                key={item.ymd}
                type="button"
                onClick={() => setSelectedDate(item.ymd)}
                className={cx(
                  "min-w-[74px] rounded-xl border px-3 py-2 text-center transition",
                  item.ymd === selectedDate
                    ? "border-indigo-700 bg-indigo-700 text-white shadow-sm"
                    : "border-transparent bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-100",
                )}
              >
                <span className="block text-[9px] font-black tracking-wide">
                  {item.weekday}
                </span>
                <span className="mt-0.5 block text-lg font-black leading-none">
                  {item.day}
                </span>
              </button>
            ))}
            <div className="ml-auto hidden items-center gap-2 px-3 text-[10px] font-medium text-slate-500 lg:flex">
              <span>Celda rápida:</span>
              <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">✓ Verde</span>
              <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-700">× Rojo</span>
              <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-orange-700">! Pendiente</span>
            </div>
          </div>

          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Ocupados"
              value={occupied}
              hint="citas"
              tone="slate"
              onClick={() => setFilterMode("all")}
              active={filterMode === "all"}
            />
            <MetricCard
              label="Disponibles"
              value={available}
              hint="lugares"
              tone="green"
              onClick={() => setFilterMode("available")}
              active={filterMode === "available"}
            />
            <MetricCard
              label="Sin resultado"
              value={pending}
              hint="por capturar"
              tone="amber"
              onClick={() => setFilterMode("pending")}
              active={filterMode === "pending"}
            />
            <MetricCard
              label="Alertas"
              value={alerts}
              hint="en rojo"
              tone="red"
              onClick={() => setFilterMode("alerts")}
              active={filterMode === "alerts"}
            />
            <MetricCard
              label="Manuales CRM"
              value={manualCrm}
              hint="capturas"
              tone="indigo"
              onClick={() => setFilterMode("manual")}
              active={filterMode === "manual"}
            />
          </div>
        </section>

        <section className="sticky top-0 z-30 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-slate-400">
                ⌕
              </span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar NSS, cliente, asesor, resultado o nota…"
                className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <select
              value={filterMode}
              onChange={(event) => setFilterMode(event.target.value as FilterMode)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 outline-none"
              aria-label="Filtro de estado"
            >
              <option value="all">Todos</option>
              <option value="pending">Sin resultado</option>
              <option value="alerts">Solo alertas rojas</option>
              <option value="available">Solo lugares disponibles</option>
              <option value="manual">Solo manuales CRM</option>
            </select>

            <button
              type="button"
              onClick={() => setCompact((value) => !value)}
              className={cx(
                "h-10 rounded-xl border px-3 text-xs font-bold transition",
                compact
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-300 bg-white text-slate-600",
              )}
            >
              {compact ? "✓ Compacto" : "Vista cómoda"}
            </button>

            <button
              type="button"
              onClick={collapseAll}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
            >
              − Minimizar todo
            </button>
            <button
              type="button"
              onClick={expandAll}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
            >
              + Mostrar todo
            </button>

            {(search || filterMode !== "all" || sectionFilter !== "all") ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setFilterMode("all");
                  setSectionFilter("all");
                }}
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Limpiar filtros
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSectionFilter("all")}
              className={cx(
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-bold transition",
                sectionFilter === "all"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              Todas las secciones
            </button>
            {SECTIONS.map((section) => {
              const key = section.locationId + ":" + section.kind;
              const count = rows.filter(
                (row) =>
                  row.locationId === section.locationId &&
                  row.kind === section.kind,
              ).length;
              if (count === 0) return null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSectionFilter(key)}
                  className={cx(
                    "whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-bold transition",
                    sectionFilter === key
                      ? "border-indigo-700 bg-indigo-700 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {section.short} · {count}
                </button>
              );
            })}

          </div>

          <p className="mt-2 text-[10px] font-medium text-slate-400">
            Escribe directo en la celda, cambia el color con un clic y usa ⌘/Ctrl + Enter para guardar la fila.
          </p>
        </section>

        <section className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-sky-950">
                Drive sigue activo y sincronizado.
              </p>
              <p className="mt-0.5 text-[10px] leading-4 text-sky-800">
                Resultados, colores y notas se capturan aquí sin mover etapas automáticamente. Los espacios normales siguen sincronizados con Google.
              </p>
            </div>
            <span className="rounded-full border border-sky-200 bg-white px-2 py-1 text-[10px] font-bold text-sky-700">
              {filteredRows.length} filas visibles
            </span>
          </div>
        </section>

        {manualTarget ? (
          <ManualCapturePanel
            key={
              manualTarget.bookingDate +
              "-" +
              manualTarget.kind +
              "-" +
              manualTarget.locationId +
              "-" +
              manualTarget.logicalTime
            }
            target={manualTarget}
            saving={manualSaving}
            error={manualError}
            onClose={() => {
              setManualTarget(null);
              setManualError(null);
            }}
            onSubmit={handleManualSubmit}
          />
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          >
            {error}
          </p>
        ) : null}

        {loading && rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm font-medium text-slate-500">
            Cargando hoja operativa…
          </div>
        ) : null}

        {!loading && !error && sections.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center">
            <p className="text-sm font-bold text-slate-700">
              No hay filas con estos filtros.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Prueba limpiar la búsqueda o mostrar todas las secciones.
            </p>
          </div>
        ) : null}

        {sections.map((section) => (
          <section
            key={section.key}
            id={section.locationId === "leo" ? "leo-hacer-pagares" : undefined}
            className={cx(
              "overflow-hidden rounded-2xl bg-white shadow-sm",
              section.locationId === "leo"
                ? "border border-orange-300"
                : "border border-slate-300",
            )}
          >
            <div
              className={cx(
                "px-4 py-2.5 text-white",
                section.locationId === "leo"
                  ? "bg-orange-500"
                  : sectionTone(section.kind),
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.key)}
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-white/25 bg-white/10 text-sm font-black text-white transition hover:bg-white/20"
                    aria-label={
                      collapsedSections.has(section.key)
                        ? "Mostrar sección " + section.label
                        : "Minimizar sección " + section.label
                    }
                    title={collapsedSections.has(section.key) ? "Mostrar" : "Minimizar"}
                  >
                    {collapsedSections.has(section.key) ? "+" : "−"}
                  </button>
                  <h3 className="text-sm font-black tracking-wide">
                    {section.label}
                  </h3>
                  {section.alerts > 0 ? (
                    <span className="rounded-full border border-white/25 bg-red-500 px-2 py-0.5 text-[9px] font-black">
                      {section.alerts} alerta{section.alerts === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                {section.locationId === "leo" ? (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-white/90">
                    <span>{section.rows.length} registros del Drive</span>
                    <span>·</span>
                    <span>no consumen cupo</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-white/80">
                    <span>{section.occupied} ocupados</span>
                    <span>·</span>
                    <span>{section.available} libres</span>
                    <span>·</span>
                    <span>{section.pending} sin resultado</span>
                  </div>
                )}
              </div>
            </div>

            {!collapsedSections.has(section.key) ? (
            <div>
              {section.locationId === "leo" ? (
                <div className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-[10px] font-medium text-orange-900">
                  Mismo bloque que aparece inmediatamente debajo de Monterrey Biométricos en CITAS 2026. Se leen Hora, NSS, Nombre, Asesor, Biométricos, Notificación y Notas directamente de Drive; no cuenta dentro de los 15 lugares.
                </div>
              ) : null}
              <div className="max-h-[68vh] overflow-auto">
              <table className={cx(
                "w-full table-fixed border-collapse text-left",
                section.kind === "biometricos" ? "min-w-[1320px]" : "min-w-[1500px]",
              )}>
                <thead className="sticky top-0 z-20 bg-slate-100 text-[10px] font-black uppercase tracking-wide text-slate-600 shadow-[0_1px_0_rgba(148,163,184,0.35)]">
                  <tr>
                    <th className="sticky left-0 z-30 w-[78px] border-r border-slate-200 bg-slate-100 px-2 py-2 text-center">
                      Hora
                    </th>
                    <th className="sticky left-[78px] z-30 w-[128px] border-r border-slate-200 bg-slate-100 px-2 py-2">
                      NSS
                    </th>
                    <th className="sticky left-[206px] z-30 w-[244px] border-r border-slate-200 bg-slate-100 px-3 py-2">
                      Cliente
                    </th>
                    <th className="sticky left-[450px] z-30 w-[190px] border-r border-slate-200 bg-slate-100 px-2 py-2">
                      Asesor
                    </th>
                    <th className="w-[178px] border-r border-slate-200 px-2 py-2">
                      Biométricos
                    </th>
                    <th className="w-[178px] border-r border-slate-200 px-2 py-2">
                      Notificación
                    </th>
                    {section.kind !== "biometricos" ? (
                      <th className="w-[178px] border-r border-slate-200 px-2 py-2">
                        {section.kind === "firmas" ? "Firmó / Firma" : "Firma"}
                      </th>
                    ) : null}
                    <th className="w-[235px] border-r border-slate-200 px-2 py-2">
                      Notas
                    </th>
                    <th className="w-[155px] px-2 py-2">
                      Estado / acción
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <EditableAgendaRow
                      key={row.rowSource + "-" + row.rowId}
                      row={row}
                      compact={compact}
                      suggestions={suggestions}
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
            </div>
            ) : (
              <div className="flex items-center justify-between gap-3 bg-white px-4 py-2 text-[10px] font-medium text-slate-500">
                <span>
                  {section.locationId === "leo"
                    ? "LEO / Hacer pagarés minimizado."
                    : "Sección minimizada para tener mayor control visual."}
                </span>
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  className="font-black text-indigo-700 hover:underline"
                >
                  Mostrar
                </button>
              </div>
            )}
          </section>
        ))}

        <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-medium text-slate-500">
            <span className="font-black text-slate-700">Guía rápida</span>
            <span><b className="text-emerald-700">✓ Verde</b> = correcto / completado</span>
            <span><b className="text-red-700">× Rojo</b> = incidencia / no asistió</span>
            <span><b className="text-orange-700">! Naranja</b> = pendiente / seguimiento</span>
            <span><b>○ Sin color</b> = sin clasificación</span>
            <span><b>Biométricos</b> = Biométricos + Notificación, igual que Drive</span>
            <span><b>⌘/Ctrl + Enter</b> = guardar fila</span>
          </div>
        </section>
      </main>
    </div>
  );
}
