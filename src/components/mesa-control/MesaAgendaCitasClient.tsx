"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSessionRepo } from "@/domain/session";
import {
  useAgendaBiometricosBookingRepo,
  AgendaBiometricosSupabaseError,
} from "@/domain/agenda-biometricos";
import {
  useAgendaFirmasBookingRepo,
  AgendaFirmasSupabaseError,
} from "@/domain/agenda-firmas";
import { fetchMesaAgendaBookings } from "@/domain/agenda-calendar/mesa.repo";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  MesaAgendaCitasBackLink,
  MesaAgendaCitasFilters,
} from "@/components/mesa-control/MesaAgendaCitasFilters";
import { MesaAgendaCitasFilterChips } from "@/components/mesa-control/MesaAgendaCitasFilterChips";
import { MesaAgendaCitasList } from "@/components/mesa-control/MesaAgendaCitasList";
import { MesaAgendaCitasDayView } from "@/components/mesa-control/MesaAgendaCitasDayView";
import { MesaAgendaCitasWeekView } from "@/components/mesa-control/MesaAgendaCitasWeekView";
import { MesaAgendaCitasSummary } from "@/components/mesa-control/MesaAgendaCitasSummary";
import { MesaAgendaCitasViewControls } from "@/components/mesa-control/MesaAgendaCitasViewControls";
import { MesaCancelarCitaDialog } from "@/components/mesa-control/MesaCancelarCitaDialog";
import {
  MesaReagendarCitaDialog,
  type MesaReagendarConfirmPayload,
} from "@/components/mesa-control/MesaReagendarCitaDialog";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { Button } from "@/components/ui/Button";
import { getEffectiveMockName, getEffectiveMockRole } from "@/lib/mockUser";
import {
  MESA_CANCEL_SUCCESS_MESSAGE,
  type MesaAgendaCancelKind,
} from "@/lib/mesaAgendaCancelAccess";
import {
  applyMesaAgendaClientFiltersAndSort,
  buildMesaAgendaActiveFilterChips,
  buildMesaAgendaAdvisorOptions,
  buildMesaAgendaLocationOptions,
  buildMesaAgendaWeekRange,
  canAccessMesaAgendaCitasPage,
  canMesaCancelAgendaListEntry,
  canMesaReagendarAgendaListEntry,
  clearMesaAgendaClientFilters,
  defaultMesaAgendaClientFilters,
  defaultMesaAgendaMonthRange,
  deriveMesaAgendaSummary,
  filterMesaAgendaEntriesForDay,
  groupMesaAgendaHistory,
  mapMesaAgendaCancelErrorMessage,
  mapMesaAgendaFetchErrorMessage,
  mapMesaAgendaReagendarErrorMessage,
  mesaAgendaCancelDialogKindLabel,
  mesaAgendaKindUiToRpcFilter,
  MESA_AGENDA_DEFAULT_SORT,
  MESA_AGENDA_DEFAULT_VIEW,
  MESA_REAGENDAR_SUCCESS_MESSAGE,
  resolveMesaAgendaFetchRange,
  shiftMesaAgendaDayYmd,
  todayMesaAgendaYmd,
  validateMesaAgendaDateRange,
  type MesaAgendaCitasClientFilters,
  type MesaAgendaCitasSortOption,
  type MesaAgendaCitasViewMode,
  type MesaAgendaFilterChip,
} from "@/lib/mesaAgendaCitasUi";

export function MesaAgendaCitasClient() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const agendaBookingRepo = useAgendaBiometricosBookingRepo();
  const firmasBookingRepo = useAgendaFirmasBookingRepo();
  const defaultRange = useMemo(() => defaultMesaAgendaMonthRange(), []);

  const [viewMode, setViewMode] = useState<MesaAgendaCitasViewMode>(MESA_AGENDA_DEFAULT_VIEW);
  const [sortBy, setSortBy] = useState<MesaAgendaCitasSortOption>(MESA_AGENDA_DEFAULT_SORT);
  const [listaStartDate, setListaStartDate] = useState(defaultRange.startDate);
  const [listaEndDate, setListaEndDate] = useState(defaultRange.endDate);
  const [selectedDay, setSelectedDay] = useState(() => todayMesaAgendaYmd());
  const [weekAnchor, setWeekAnchor] = useState(() => todayMesaAgendaYmd());
  const [weekDetailDay, setWeekDetailDay] = useState<string | null>(null);
  const [filters, setFilters] = useState<MesaAgendaCitasClientFilters>(
    defaultMesaAgendaClientFilters(),
  );
  const [loadedEntries, setLoadedEntries] = useState<MesaAgendaBookingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MesaAgendaBookingEntry | null>(null);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);
  const [reagendarTarget, setReagendarTarget] = useState<MesaAgendaBookingEntry | null>(null);
  const [reagendarSaving, setReagendarSaving] = useState(false);
  const [reagendarError, setReagendarError] = useState<string | null>(null);
  const [reagendarSuccess, setReagendarSuccess] = useState<string | null>(null);

  const canAccess = canAccessMesaAgendaCitasPage(currentUser?.role);
  const mockRole = getEffectiveMockRole();
  const sessionRole = currentUser?.role ?? null;

  const weekRange = useMemo(() => buildMesaAgendaWeekRange(weekAnchor), [weekAnchor]);

  const fetchRange = useMemo(
    () =>
      resolveMesaAgendaFetchRange({
        viewMode,
        listaStartDate,
        listaEndDate,
        selectedDay,
        weekAnchor,
      }),
    [viewMode, listaStartDate, listaEndDate, selectedDay, weekAnchor],
  );

  const cancelRoleParams = useMemo(
    () => ({ mockRole, sessionRole }),
    [mockRole, sessionRole],
  );

  const canCancelEntry = useCallback(
    (entry: MesaAgendaBookingEntry) =>
      canMesaCancelAgendaListEntry(entry, cancelRoleParams),
    [cancelRoleParams],
  );

  const canReagendarEntry = useCallback(
    (entry: MesaAgendaBookingEntry) =>
      canMesaReagendarAgendaListEntry(entry, cancelRoleParams).allowed,
    [cancelRoleParams],
  );

  const loadEntries = useCallback(async () => {
    const rangeCheck = validateMesaAgendaDateRange(fetchRange.startDate, fetchRange.endDate);
    if (!rangeCheck.ok) {
      setRangeError(rangeCheck.message);
      setError(null);
      return;
    }
    setRangeError(null);
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchMesaAgendaBookings({
        startDate: fetchRange.startDate,
        endDate: fetchRange.endDate,
        includeCancelled: filters.includeCancelled,
        kind: mesaAgendaKindUiToRpcFilter(filters.kindUi),
      });
      setLoadedEntries(rows);
    } catch (err) {
      setLoadedEntries([]);
      setError(mapMesaAgendaFetchErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [fetchRange.endDate, fetchRange.startDate, filters.includeCancelled, filters.kindUi]);

  useEffect(() => {
    if (!currentUser || !canAccess) return;
    void loadEntries();
  }, [currentUser, canAccess, loadEntries]);

  const advisorOptions = useMemo(
    () => buildMesaAgendaAdvisorOptions(loadedEntries),
    [loadedEntries],
  );
  const locationOptions = useMemo(
    () => buildMesaAgendaLocationOptions(loadedEntries),
    [loadedEntries],
  );

  const visibleEntries = useMemo(
    () => applyMesaAgendaClientFiltersAndSort(loadedEntries, filters, sortBy),
    [loadedEntries, filters, sortBy],
  );

  const dayViewEntries = useMemo(
    () => filterMesaAgendaEntriesForDay(visibleEntries, selectedDay),
    [visibleEntries, selectedDay],
  );

  const summary = useMemo(() => deriveMesaAgendaSummary(visibleEntries), [visibleEntries]);

  const historyGroups = useMemo(() => {
    const map = groupMesaAgendaHistory(visibleEntries);
    return map as ReadonlyMap<string, readonly MesaAgendaBookingEntry[]>;
  }, [visibleEntries]);

  const filterChips = useMemo(
    () =>
      buildMesaAgendaActiveFilterChips(filters, {
        advisorOptions,
        locationOptions,
      }),
    [filters, advisorOptions, locationOptions],
  );

  const handleFiltersChange = useCallback((patch: Partial<MesaAgendaCitasClientFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleClearChip = useCallback((chip: MesaAgendaFilterChip) => {
    setFilters((prev) => ({ ...prev, ...chip.clearPatch }));
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setFilters(clearMesaAgendaClientFilters());
  }, []);

  const handleViewModeChange = useCallback((mode: MesaAgendaCitasViewMode) => {
    setViewMode(mode);
    if (mode === "dia") {
      setSelectedDay((prev) => prev || todayMesaAgendaYmd());
    }
    if (mode === "semana") {
      setWeekAnchor((prev) => prev || todayMesaAgendaYmd());
      setWeekDetailDay(null);
    }
  }, []);

  const handleGoToday = useCallback(() => {
    const today = todayMesaAgendaYmd();
    if (viewMode === "dia") {
      setSelectedDay(today);
    } else if (viewMode === "semana") {
      setWeekAnchor(today);
      setWeekDetailDay(today);
    }
  }, [viewMode]);

  const handleShiftDay = useCallback((delta: number) => {
    setSelectedDay((prev) => shiftMesaAgendaDayYmd(prev, delta));
  }, []);

  const handleShiftWeek = useCallback((delta: number) => {
    setWeekAnchor((prev) => shiftMesaAgendaDayYmd(prev, delta * 7));
    setWeekDetailDay(null);
  }, []);

  const handleRequestCancel = useCallback((entry: MesaAgendaBookingEntry) => {
    setCancelError(null);
    setCancelSuccess(null);
    setReagendarSuccess(null);
    setCancelTarget(entry);
  }, []);

  const handleRequestReagendar = useCallback((entry: MesaAgendaBookingEntry) => {
    setReagendarError(null);
    setReagendarSuccess(null);
    setCancelSuccess(null);
    setReagendarTarget(entry);
  }, []);

  const handleCloseCancelDialog = useCallback(() => {
    if (cancelSaving) return;
    setCancelTarget(null);
    setCancelError(null);
  }, [cancelSaving]);

  const handleConfirmCancel = useCallback(
    async (motivo: string) => {
      if (!cancelTarget) return;
      const kind = cancelTarget.kind as MesaAgendaCancelKind;
      setCancelSaving(true);
      setCancelError(null);
      try {
        if (kind === "firmas") {
          if (!firmasBookingRepo) {
            throw new AgendaFirmasSupabaseError(
              "La cancelación de firmas requiere modo Supabase.",
            );
          }
          await firmasBookingRepo.cancelFirmas({
            expedienteId: cancelTarget.expedienteId,
            motivo,
          });
        } else if (kind === "notificacion") {
          if (!agendaBookingRepo) {
            throw new AgendaBiometricosSupabaseError(
              "La cancelación de notificación requiere modo Supabase.",
            );
          }
          await agendaBookingRepo.cancelNotificacionEtapa3({
            expedienteId: cancelTarget.expedienteId,
            motivo,
          });
        } else {
          if (!agendaBookingRepo) {
            throw new AgendaBiometricosSupabaseError(
              "La cancelación biométrica requiere modo Supabase.",
            );
          }
          await agendaBookingRepo.cancelBiometricos({
            expedienteId: cancelTarget.expedienteId,
            motivo,
          });
        }
        setCancelTarget(null);
        setCancelSuccess(MESA_CANCEL_SUCCESS_MESSAGE);
        await loadEntries();
      } catch (err) {
        setCancelError(mapMesaAgendaCancelErrorMessage(err, kind));
      } finally {
        setCancelSaving(false);
      }
    },
    [agendaBookingRepo, cancelTarget, firmasBookingRepo, loadEntries],
  );

  const handleCloseReagendarDialog = useCallback(() => {
    if (reagendarSaving) return;
    setReagendarTarget(null);
    setReagendarError(null);
  }, [reagendarSaving]);

  const handleConfirmReagendar = useCallback(
    async (payload: MesaReagendarConfirmPayload) => {
      if (!reagendarTarget) return;
      const kind = reagendarTarget.kind;
      setReagendarSaving(true);
      setReagendarError(null);
      try {
        if (payload.kind === "firmas") {
          if (!firmasBookingRepo) {
            throw new AgendaFirmasSupabaseError("La reagenda de firmas requiere modo Supabase.");
          }
          await firmasBookingRepo.reagendarFirmas({
            expedienteId: reagendarTarget.expedienteId,
            scheduledAt: payload.scheduledAt,
            locationId: payload.locationId,
            note: payload.note,
          });
        } else if (payload.kind === "notificacion") {
          if (!agendaBookingRepo) {
            throw new AgendaBiometricosSupabaseError(
              "La reagenda de notificación requiere modo Supabase.",
            );
          }
          await agendaBookingRepo.mesaReagendarNotificacion({
            expedienteId: reagendarTarget.expedienteId,
            bookingDate: payload.bookingDate,
            note: payload.note,
          });
        } else {
          if (!agendaBookingRepo) {
            throw new AgendaBiometricosSupabaseError(
              "La reagenda biométrica requiere modo Supabase.",
            );
          }
          await agendaBookingRepo.mesaReagendarBiometricos({
            expedienteId: reagendarTarget.expedienteId,
            bookingDate: payload.bookingDate,
            bookingTime: payload.bookingTime,
            locationId: payload.locationId,
            note: payload.note,
          });
        }
        setReagendarTarget(null);
        setReagendarSuccess(MESA_REAGENDAR_SUCCESS_MESSAGE);
        await loadEntries();
      } catch (err) {
        setReagendarError(mapMesaAgendaReagendarErrorMessage(err, kind));
      } finally {
        setReagendarSaving(false);
      }
    },
    [agendaBookingRepo, firmasBookingRepo, loadEntries, reagendarTarget],
  );

  const sharedListProps = {
    historyGroups,
    canCancelEntry,
    canReagendarEntry,
    cancelPendingBookingId: cancelSaving ? cancelTarget?.bookingId ?? null : null,
    reagendarPendingBookingId: reagendarSaving ? reagendarTarget?.bookingId ?? null : null,
    onRequestCancel: handleRequestCancel,
    onRequestReagendar: handleRequestReagendar,
  };

  const hasVisibleEntries =
    viewMode === "lista"
      ? visibleEntries.length > 0
      : viewMode === "dia"
        ? dayViewEntries.length > 0
        : visibleEntries.length > 0;

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-600">
          <Link href="/login" className="text-blue-600 underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-slate-50">
        <MesaAgendaCitasShell currentUser={currentUser} sessionRepo={sessionRepo}>
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No tienes permiso para consultar la agenda de Mesa.
          </p>
        </MesaAgendaCitasShell>
      </div>
    );
  }

  return (
    <MesaAgendaCitasShell currentUser={currentUser} sessionRepo={sessionRepo}>
      <div className="space-y-4">
        <MesaAgendaCitasBackLink />

        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
            Agenda de citas
          </h1>
          <p className="text-sm text-slate-500">
            Consulta y administra citas visibles para tu rol en Mesa Control.
          </p>
        </div>

        <MesaAgendaCitasViewControls
          viewMode={viewMode}
          startDate={listaStartDate}
          endDate={listaEndDate}
          selectedDay={selectedDay}
          weekDays={weekRange.days}
          loading={loading}
          onViewModeChange={handleViewModeChange}
          onStartDateChange={setListaStartDate}
          onEndDateChange={setListaEndDate}
          onSelectedDayChange={setSelectedDay}
          onShiftDay={handleShiftDay}
          onShiftWeek={handleShiftWeek}
          onGoToday={handleGoToday}
          onRefresh={() => void loadEntries()}
        />

        <MesaAgendaCitasFilters
          filters={filters}
          advisorOptions={advisorOptions}
          locationOptions={locationOptions}
          loading={loading}
          onFiltersChange={handleFiltersChange}
        />

        <MesaAgendaCitasFilterChips
          chips={filterChips}
          onClearChip={handleClearChip}
          onClearAll={handleClearAllFilters}
        />

        {!loading && !error && !rangeError ? (
          <MesaAgendaCitasSummary
            summary={summary}
            includeCancelled={filters.includeCancelled}
          />
        ) : null}

        {rangeError ? (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {rangeError}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-600" role="status">
            Cargando citas…
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <p>{error}</p>
            <button
              type="button"
              className="mt-2 text-sm font-medium text-red-900 underline"
              onClick={() => void loadEntries()}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {!loading && !error && !rangeError && !hasVisibleEntries ? (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
            No hay citas para el rango y los filtros seleccionados.
          </p>
        ) : null}

        {!loading && !error && !rangeError && viewMode === "lista" && visibleEntries.length > 0 ? (
          <MesaAgendaCitasList
            entries={visibleEntries}
            sortBy={sortBy}
            onSortChange={setSortBy}
            {...sharedListProps}
          />
        ) : null}

        {!loading && !error && !rangeError && viewMode === "dia" && dayViewEntries.length > 0 ? (
          <MesaAgendaCitasDayView entries={dayViewEntries} {...sharedListProps} />
        ) : null}

        {!loading && !error && !rangeError && viewMode === "semana" && visibleEntries.length > 0 ? (
          <MesaAgendaCitasWeekView
            entries={visibleEntries}
            weekDays={weekRange.days}
            selectedDetailDay={weekDetailDay}
            onSelectDay={setWeekDetailDay}
            {...sharedListProps}
          />
        ) : null}

        {cancelSuccess ? (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            {cancelSuccess}
          </p>
        ) : null}

        {reagendarSuccess ? (
          <p
            role="status"
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
          >
            {reagendarSuccess}
          </p>
        ) : null}
      </div>

      <MesaCancelarCitaDialog
        open={cancelTarget != null}
        kindLabel={
          cancelTarget
            ? mesaAgendaCancelDialogKindLabel(cancelTarget.kind)
            : ""
        }
        saving={cancelSaving}
        error={cancelError}
        onClose={handleCloseCancelDialog}
        onConfirm={handleConfirmCancel}
      />

      <MesaReagendarCitaDialog
        open={reagendarTarget != null}
        entry={reagendarTarget}
        saving={reagendarSaving}
        error={reagendarError}
        onClose={handleCloseReagendarDialog}
        onConfirm={handleConfirmReagendar}
      />
    </MesaAgendaCitasShell>
  );
}

function MesaAgendaCitasShell({
  currentUser,
  sessionRepo,
  children,
}: Readonly<{
  currentUser: { email: string };
  sessionRepo: { logout: () => Promise<void> };
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
              Mesa de control
            </h2>
            <p className="text-xs text-slate-500">Agenda de citas · ConCasa CRM</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[220px] flex-col truncate text-right text-xs text-slate-500 sm:flex">
              <span className="truncate font-medium text-slate-700">
                {getEffectiveMockName() || currentUser.email}
              </span>
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
                  console.error("[logout] mesa-citas:", err);
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
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">{children}</main>
    </div>
  );
}
