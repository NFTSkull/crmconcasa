"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  fetchMesaAgendaBookings,
  setMesaAgendaDriveValidation,
} from "@/domain/agenda-calendar/mesa.repo";
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
import { MesaAgendaBulkSelectionBar } from "@/components/mesa-control/MesaAgendaBulkSelectionBar";
import { MesaAgendaBulkDriveConfirmDialog } from "@/components/mesa-control/MesaAgendaBulkDriveConfirmDialog";
import { MesaAgendaBulkDriveResultPanel } from "@/components/mesa-control/MesaAgendaBulkDriveResultPanel";
import { MesaAgendaBulkAdvanceConfirmDialog } from "@/components/mesa-control/MesaAgendaBulkAdvanceConfirmDialog";
import { MesaAgendaBulkAdvanceResultPanel } from "@/components/mesa-control/MesaAgendaBulkAdvanceResultPanel";
import { MesaCancelarCitaDialog } from "@/components/mesa-control/MesaCancelarCitaDialog";
import {
  MesaReagendarCitaDialog,
  type MesaReagendarConfirmPayload,
} from "@/components/mesa-control/MesaReagendarCitaDialog";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { Button } from "@/components/ui/Button";
import { useExpedientesRepo, ExpedientesSupabaseError } from "@/domain/expedientes";
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
  canMesaShowDriveValidationActions,
  clearMesaAgendaClientFilters,
  defaultMesaAgendaClientFilters,
  defaultMesaAgendaDayRange,
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
  syncMesaAgendaSingleDay,
  todayMesaAgendaYmd,
  validateMesaAgendaDateRange,
  type MesaAgendaCitasClientFilters,
  type MesaAgendaCitasSortOption,
  type MesaAgendaCitasViewMode,
  type MesaAgendaFilterChip,
} from "@/lib/mesaAgendaCitasUi";
import { MesaAgendaBookingsSupabaseError } from "@/domain/agenda-calendar/mesa.mapper";
import { mapMesaAgendaDriveValidationRpcError } from "@/domain/agenda-calendar/mesa-drive-validation-rpc-error";
import {
  buildBulkSelectionSummary,
  executeBulkDriveValidation,
  executeBulkStageAdvance,
  formatBulkNotSelectableReason,
  isBulkSelectable,
  planBulkDriveValidation,
  planBulkStageAdvance,
  reconcileBulkSelection,
  removeSuccessfulBookingsFromSelection,
  removeSuccessfulExpedientesFromSelection,
  selectAllEligibleVisible,
  toggleBookingInSelection,
  type BulkAdvancePlan,
  type BulkDrivePlan,
  type BulkDriveValidationSummary,
  type BulkStageAdvanceSummary,
} from "@/domain/agenda-calendar/mesa-bulk-actions";
import {
  downloadMesaCitasExcel,
  mapMesaCitasExportUserMessage,
  resolveMesaCitasExportDayYmd,
} from "@/lib/exportMesaCitasExcel";

export function MesaAgendaCitasClient() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const expedientesRepo = useExpedientesRepo();
  const agendaBookingRepo = useAgendaBiometricosBookingRepo();
  const firmasBookingRepo = useAgendaFirmasBookingRepo();
  const defaultRange = useMemo(() => defaultMesaAgendaDayRange(), []);

  const [viewMode, setViewMode] = useState<MesaAgendaCitasViewMode>(MESA_AGENDA_DEFAULT_VIEW);
  const [sortBy, setSortBy] = useState<MesaAgendaCitasSortOption>(MESA_AGENDA_DEFAULT_SORT);
  const [listaStartDate, setListaStartDate] = useState(defaultRange.startDate);
  const [listaEndDate, setListaEndDate] = useState(defaultRange.endDate);
  const [selectedDay, setSelectedDay] = useState(defaultRange.startDate);
  const [weekAnchor, setWeekAnchor] = useState(defaultRange.startDate);
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
  const [drivePendingBookingId, setDrivePendingBookingId] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccess, setDriveSuccess] = useState<string | null>(null);
  const [selectedBookingIds, setSelectedBookingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [bulkLimitNotice, setBulkLimitNotice] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgressLabel, setBulkProgressLabel] = useState<string | null>(null);
  const [bulkDriveConfirmOpen, setBulkDriveConfirmOpen] = useState(false);
  const [bulkDrivePlan, setBulkDrivePlan] = useState<BulkDrivePlan | null>(null);
  const [bulkDriveResult, setBulkDriveResult] = useState<BulkDriveValidationSummary | null>(
    null,
  );
  const [bulkAdvanceConfirmOpen, setBulkAdvanceConfirmOpen] = useState(false);
  const [bulkAdvancePlan, setBulkAdvancePlan] = useState<BulkAdvancePlan | null>(null);
  const [bulkAdvanceResult, setBulkAdvanceResult] = useState<BulkStageAdvanceSummary | null>(
    null,
  );
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [exportExcelMessage, setExportExcelMessage] = useState<string | null>(null);
  const bulkBusyRef = useRef(false);
  const exportExcelBusyRef = useRef(false);

  const canAccess = canAccessMesaAgendaCitasPage(currentUser?.role);
  const mockRole = getEffectiveMockRole();
  const sessionRole = currentUser?.role ?? null;
  const bulkRole = mockRole || sessionRole;

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

  const canDriveValidateEntry = useCallback(
    (entry: MesaAgendaBookingEntry) =>
      canMesaShowDriveValidationActions(entry, mockRole) ||
      canMesaShowDriveValidationActions(entry, sessionRole),
    [mockRole, sessionRole],
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

  const weekDetailEntries = useMemo(() => {
    const detailDay =
      weekDetailDay ??
      weekRange.days.find(
        (day) => filterMesaAgendaEntriesForDay(visibleEntries, day).length > 0,
      ) ??
      weekRange.days[0] ??
      null;
    return detailDay
      ? filterMesaAgendaEntriesForDay(visibleEntries, detailDay)
      : visibleEntries;
  }, [visibleEntries, weekDetailDay, weekRange.days]);

  /** Citas renderizadas en la vista actual (alcance de «Seleccionar elegibles visibles»). */
  const selectionScopeEntries = useMemo(() => {
    if (viewMode === "dia") return dayViewEntries;
    if (viewMode === "semana") return weekDetailEntries;
    return visibleEntries;
  }, [viewMode, dayViewEntries, weekDetailEntries, visibleEntries]);

  const selectionClearKey = useMemo(
    () =>
      [
        viewMode,
        listaStartDate,
        listaEndDate,
        selectedDay,
        weekAnchor,
        weekDetailDay ?? "",
        filters.kindUi,
        String(filters.includeCancelled),
        filters.locationId,
        filters.asesorId,
        filters.search,
      ].join("|"),
    [
      viewMode,
      listaStartDate,
      listaEndDate,
      selectedDay,
      weekAnchor,
      weekDetailDay,
      filters.kindUi,
      filters.includeCancelled,
      filters.locationId,
      filters.asesorId,
      filters.search,
    ],
  );

  useEffect(() => {
    setSelectedBookingIds(new Set());
    setBulkLimitNotice(null);
    setExportExcelMessage(null);
  }, [selectionClearKey]);

  useEffect(() => {
    setSelectedBookingIds((prev) => {
      if (prev.size === 0) return prev;
      const next = reconcileBulkSelection(prev, loadedEntries, bulkRole);
      if (next.size === prev.size) {
        let same = true;
        for (const id of prev) {
          if (!next.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, [loadedEntries, bulkRole]);

  const bulkSummary = useMemo(
    () => buildBulkSelectionSummary(selectionScopeEntries, selectedBookingIds, bulkRole),
    [selectionScopeEntries, selectedBookingIds, bulkRole],
  );

  const showBulkBar =
    bulkSummary.eligibleVisibleCount > 0 || selectedBookingIds.size > 0;

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

  const exportDayYmd = useMemo(
    () =>
      resolveMesaCitasExportDayYmd({
        viewMode,
        selectedDay,
        weekDetailDay,
        listaStartDate,
      }),
    [viewMode, selectedDay, weekDetailDay, listaStartDate],
  );

  const handleDescargarExcel = useCallback(() => {
    if (exportExcelBusyRef.current || loading || bulkBusyRef.current) return;
    exportExcelBusyRef.current = true;
    setExportExcelLoading(true);
    setExportExcelMessage(null);
    void (async () => {
      try {
        // Exporta el día filtrado completo; no usa la selección masiva ni el tope de 100.
        const result = await downloadMesaCitasExcel(
          loadedEntries,
          exportDayYmd,
          filters,
          sortBy,
        );
        setExportExcelMessage(mapMesaCitasExportUserMessage(result));
      } catch {
        setExportExcelMessage(
          "No se pudo generar el archivo Excel. Intenta de nuevo.",
        );
      } finally {
        exportExcelBusyRef.current = false;
        setExportExcelLoading(false);
      }
    })();
  }, [loading, loadedEntries, exportDayYmd, filters, sortBy]);

  const handleBulkRowCheckedChange = useCallback(
    (entry: MesaAgendaBookingEntry, checked: boolean) => {
      if (bulkBusyRef.current) return;
      setSelectedBookingIds((prev) => toggleBookingInSelection(prev, entry.bookingId, checked));
      setBulkLimitNotice(null);
    },
    [],
  );

  const handleSelectAllEligible = useCallback(() => {
    if (bulkBusyRef.current) return;
    const result = selectAllEligibleVisible(selectionScopeEntries, bulkRole);
    setSelectedBookingIds(result.nextSelected);
    setBulkLimitNotice(result.limitNotice);
  }, [selectionScopeEntries, bulkRole]);

  const handleClearBulkSelection = useCallback(() => {
    if (bulkBusyRef.current) return;
    setSelectedBookingIds(new Set());
    setBulkLimitNotice(null);
  }, []);

  const handleBulkHeaderCheckedChange = useCallback(
    (checked: boolean) => {
      if (bulkBusyRef.current) return;
      if (checked) {
        const result = selectAllEligibleVisible(selectionScopeEntries, bulkRole);
        setSelectedBookingIds(result.nextSelected);
        setBulkLimitNotice(result.limitNotice);
      } else {
        setSelectedBookingIds(new Set());
        setBulkLimitNotice(null);
      }
    },
    [selectionScopeEntries, bulkRole],
  );

  const handleRequestBulkDriveValidate = useCallback(() => {
    if (bulkBusyRef.current) return;
    const plan = planBulkDriveValidation(selectedBookingIds, loadedEntries, bulkRole);
    if (plan.eligibleEntries.length === 0) return;
    setBulkDriveResult(null);
    setBulkAdvanceResult(null);
    setDriveError(null);
    setDriveSuccess(null);
    setBulkDrivePlan(plan);
    setBulkDriveConfirmOpen(true);
  }, [selectedBookingIds, loadedEntries, bulkRole]);

  const handleCloseBulkDriveConfirm = useCallback(() => {
    if (bulkBusyRef.current) return;
    setBulkDriveConfirmOpen(false);
    setBulkDrivePlan(null);
    setBulkProgressLabel(null);
  }, []);

  const handleConfirmBulkDriveValidate = useCallback(async () => {
    if (bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    setBulkBusy(true);
    setBulkProgressLabel("Validando 0 de …");
    setDriveError(null);
    setDriveSuccess(null);
    setCancelSuccess(null);
    setReagendarSuccess(null);
    setBulkDriveResult(null);
    setBulkAdvanceResult(null);

    const selectedSnapshot = new Set(selectedBookingIds);
    try {
      const summary = await executeBulkDriveValidation({
        selectedBookingIds: selectedSnapshot,
        loadedEntries,
        role: bulkRole,
        validate: async (bookingId) => {
          await setMesaAgendaDriveValidation({
            bookingId,
            validated: true,
          });
        },
        onProgress: (done, total) => {
          setBulkProgressLabel(`Validando ${done} de ${total}…`);
        },
      });

      setSelectedBookingIds((prev) =>
        removeSuccessfulBookingsFromSelection(prev, summary),
      );
      setBulkDriveResult(summary);
      setBulkDriveConfirmOpen(false);
      setBulkDrivePlan(null);
      setBulkProgressLabel(null);
      await loadEntries();
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : "No se pudo completar la validación masiva en Drive.";
      setDriveError(message);
      setBulkDriveConfirmOpen(false);
      setBulkDrivePlan(null);
      setBulkProgressLabel(null);
    } finally {
      bulkBusyRef.current = false;
      setBulkBusy(false);
    }
  }, [selectedBookingIds, loadedEntries, bulkRole, loadEntries]);

  const handleRequestBulkStageAdvance = useCallback(() => {
    if (bulkBusyRef.current) return;
    const plan = planBulkStageAdvance(selectedBookingIds, loadedEntries, bulkRole);
    if (plan.eligibleExpedientes === 0) return;
    setBulkAdvanceResult(null);
    setBulkDriveResult(null);
    setDriveError(null);
    setDriveSuccess(null);
    setBulkAdvancePlan(plan);
    setBulkAdvanceConfirmOpen(true);
  }, [selectedBookingIds, loadedEntries, bulkRole]);

  const handleCloseBulkAdvanceConfirm = useCallback(() => {
    if (bulkBusyRef.current) return;
    setBulkAdvanceConfirmOpen(false);
    setBulkAdvancePlan(null);
    setBulkProgressLabel(null);
  }, []);

  const handleConfirmBulkStageAdvance = useCallback(async () => {
    if (bulkBusyRef.current) return;
    const preview = planBulkStageAdvance(selectedBookingIds, loadedEntries, bulkRole);
    if (preview.eligibleExpedientes === 0) {
      setBulkAdvanceConfirmOpen(false);
      setBulkAdvancePlan(null);
      return;
    }

    bulkBusyRef.current = true;
    setBulkBusy(true);
    setBulkProgressLabel("Avanzando 0 de …");
    setDriveError(null);
    setDriveSuccess(null);
    setCancelSuccess(null);
    setReagendarSuccess(null);
    setBulkDriveResult(null);
    setBulkAdvanceResult(null);

    const selectedSnapshot = new Set(selectedBookingIds);
    try {
      const summary = await executeBulkStageAdvance({
        selectedBookingIds: selectedSnapshot,
        loadedEntries,
        role: bulkRole,
        advance: async (expedienteId) => {
          await expedientesRepo.avanzarEtapaOperativa(expedienteId);
        },
        onProgress: (done, total) => {
          setBulkProgressLabel(`Avanzando ${done} de ${total} expedientes…`);
        },
      });

      setSelectedBookingIds((prev) =>
        removeSuccessfulExpedientesFromSelection(prev, summary),
      );
      setBulkAdvanceResult(summary);
      setBulkAdvanceConfirmOpen(false);
      setBulkAdvancePlan(null);
      setBulkProgressLabel(null);
      await loadEntries();
    } catch (err) {
      const message =
        err instanceof ExpedientesSupabaseError
          ? err.message
          : err instanceof Error && err.message.trim()
            ? err.message.trim()
            : "No se pudo completar el avance masivo de etapa.";
      setDriveError(message);
      setBulkAdvanceConfirmOpen(false);
      setBulkAdvancePlan(null);
      setBulkProgressLabel(null);
    } finally {
      bulkBusyRef.current = false;
      setBulkBusy(false);
    }
  }, [selectedBookingIds, loadedEntries, bulkRole, expedientesRepo, loadEntries]);

  const entriesByBookingId = useMemo(() => {
    const map = new Map<string, MesaAgendaBookingEntry>();
    for (const entry of loadedEntries) {
      map.set(entry.bookingId, entry);
    }
    return map;
  }, [loadedEntries]);

  const isBulkRowSelectableCb = useCallback(
    (entry: MesaAgendaBookingEntry) => isBulkSelectable(entry, bulkRole),
    [bulkRole],
  );

  const bulkNotSelectableReasonCb = useCallback(
    (entry: MesaAgendaBookingEntry) => formatBulkNotSelectableReason(entry, bulkRole),
    [bulkRole],
  );

  const handleViewModeChange = useCallback((mode: MesaAgendaCitasViewMode) => {
    setViewMode(mode);
    if (mode === "lista") {
      setListaStartDate(selectedDay);
      setListaEndDate(selectedDay);
    }
    if (mode === "dia") {
      setSelectedDay((prev) => prev || todayMesaAgendaYmd());
    }
    if (mode === "semana") {
      setWeekAnchor((prev) => prev || todayMesaAgendaYmd());
      setWeekDetailDay(null);
    }
  }, [selectedDay]);

  /** P095: un solo día operativo — sincroniza from/to/selectedDay. */
  const applySingleDay = useCallback((ymd: string) => {
    const day = ymd.trim();
    if (!day) return;
    const synced = syncMesaAgendaSingleDay(day);
    setListaStartDate(synced.listaStartDate);
    setListaEndDate(synced.listaEndDate);
    setSelectedDay(synced.selectedDay);
  }, []);

  const handleGoToday = useCallback(() => {
    const today = todayMesaAgendaYmd();
    if (viewMode === "semana") {
      setWeekAnchor(today);
      setWeekDetailDay(today);
      return;
    }
    applySingleDay(today);
  }, [viewMode, applySingleDay]);

  const handleShiftDay = useCallback(
    (delta: number) => {
      applySingleDay(shiftMesaAgendaDayYmd(selectedDay, delta));
    },
    [applySingleDay, selectedDay],
  );

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
    setDriveSuccess(null);
    setReagendarTarget(entry);
  }, []);

  const handleToggleDriveValidation = useCallback(
    async (entry: MesaAgendaBookingEntry) => {
      if (drivePendingBookingId || bulkBusyRef.current) return;
      setDriveError(null);
      setDriveSuccess(null);
      setCancelSuccess(null);
      setReagendarSuccess(null);
      setBulkDriveResult(null);
      setDrivePendingBookingId(entry.bookingId);
      const nextValidated = !entry.driveValidated;
      try {
        await setMesaAgendaDriveValidation({
          bookingId: entry.bookingId,
          validated: nextValidated,
        });
        setDriveSuccess(
          nextValidated
            ? "Cita marcada como Validado en Drive."
            : "Se quitó la validación en Drive.",
        );
        await loadEntries();
      } catch (err) {
        if (err instanceof MesaAgendaBookingsSupabaseError) {
          setDriveError(err.message);
        } else {
          setDriveError(mapMesaAgendaDriveValidationRpcError(err as { message?: string }).message);
        }
      } finally {
        setDrivePendingBookingId(null);
      }
    },
    [drivePendingBookingId, loadEntries],
  );


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
    canDriveValidateEntry,
    cancelPendingBookingId: cancelSaving ? cancelTarget?.bookingId ?? null : null,
    reagendarPendingBookingId: reagendarSaving ? reagendarTarget?.bookingId ?? null : null,
    drivePendingBookingId,
    onRequestCancel: handleRequestCancel,
    onRequestReagendar: handleRequestReagendar,
    onToggleDriveValidation: (entry: MesaAgendaBookingEntry) => {
      void handleToggleDriveValidation(entry);
    },
    selectedBookingIds,
    isBulkRowSelectable: isBulkRowSelectableCb,
    bulkNotSelectableReason: bulkNotSelectableReasonCb,
    onBulkRowCheckedChange: handleBulkRowCheckedChange,
    bulkBusy,
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
          onStartDateChange={applySingleDay}
          onEndDateChange={applySingleDay}
          onSelectedDayChange={applySingleDay}
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-[42px] whitespace-nowrap px-3 text-sm"
            disabled={exportExcelLoading || loading || Boolean(rangeError)}
            onClick={handleDescargarExcel}
            aria-label="Descargar Excel de citas del día"
          >
            {exportExcelLoading ? "Generando Excel…" : "Descargar Excel"}
          </Button>
          {exportExcelMessage ? (
            <p
              role="status"
              className={`text-xs ${
                exportExcelMessage.startsWith("Se descargó")
                  ? "text-emerald-800"
                  : "text-amber-800"
              }`}
            >
              {exportExcelMessage}
            </p>
          ) : null}
        </div>

        {!loading && !error && !rangeError ? (
          <MesaAgendaCitasSummary
            summary={summary}
            includeCancelled={filters.includeCancelled}
          />
        ) : null}

        {showBulkBar && !loading && !error && !rangeError ? (
          <MesaAgendaBulkSelectionBar
            summary={{
              ...bulkSummary,
              limitNotice: bulkLimitNotice ?? bulkSummary.limitNotice,
            }}
            busy={bulkBusy}
            progressLabel={bulkProgressLabel}
            onSelectAllEligible={handleSelectAllEligible}
            onClearSelection={handleClearBulkSelection}
            onHeaderCheckedChange={handleBulkHeaderCheckedChange}
            onRequestBulkDriveValidate={handleRequestBulkDriveValidate}
            onRequestBulkStageAdvance={handleRequestBulkStageAdvance}
          />
        ) : null}

        {bulkDriveResult ? (
          <MesaAgendaBulkDriveResultPanel
            summary={bulkDriveResult}
            entriesByBookingId={entriesByBookingId}
            onDismiss={() => setBulkDriveResult(null)}
          />
        ) : null}

        {bulkAdvanceResult ? (
          <MesaAgendaBulkAdvanceResultPanel
            summary={bulkAdvanceResult}
            entriesByBookingId={entriesByBookingId}
            onDismiss={() => setBulkAdvanceResult(null)}
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

        {driveSuccess ? (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            {driveSuccess}
          </p>
        ) : null}

        {driveError ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {driveError}
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

      <MesaAgendaBulkDriveConfirmDialog
        open={bulkDriveConfirmOpen}
        plan={bulkDrivePlan}
        saving={bulkBusy}
        progressLabel={bulkProgressLabel}
        onClose={handleCloseBulkDriveConfirm}
        onConfirm={() => {
          void handleConfirmBulkDriveValidate();
        }}
      />

      <MesaAgendaBulkAdvanceConfirmDialog
        open={bulkAdvanceConfirmOpen}
        plan={bulkAdvancePlan}
        saving={bulkBusy}
        progressLabel={bulkProgressLabel}
        onClose={handleCloseBulkAdvanceConfirm}
        onConfirm={() => {
          void handleConfirmBulkStageAdvance();
        }}
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
