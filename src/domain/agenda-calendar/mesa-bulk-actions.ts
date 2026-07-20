/**
 * P089: elegibilidad predictiva, selección múltiple y acciones masivas locales.
 * Drive: `mesa_set_agenda_drive_validation`. Avance: `avanzar_etapa_operativa` (autoridad final).
 */
import type {
  MesaAgendaBookingEntry,
  MesaAgendaBookingKind,
} from "@/domain/agenda-calendar/mesa.types";
import { isFechaCitaBiometricaPasada } from "@/domain/expedientes/mesa-avance-integracion";
import { normalizeBookingTime } from "@/lib/asesorAgendaCalendar";

export const MESA_BULK_SELECTION_LIMIT = 100;

/** Roles alineados con `canAccessMesaAgendaCitasPage` (sin importar UI). */
const MESA_BULK_ALLOWED_ROLES = new Set([
  "mesa_admin",
  "mesa_interno",
  "mesa_externo",
  "super_admin",
  "mesa_control",
  "mesa_control_admin",
  "mesa_control_interno",
  "mesa_control_externo",
]);

export const MESA_BULK_LIMIT_NOTICE = (selected: number, eligibleTotal: number) =>
  `Se seleccionaron ${selected} de ${eligibleTotal} citas elegibles. El límite por operación es ${MESA_BULK_SELECTION_LIMIT}.`;

export type BulkEligibility = Readonly<{
  eligible: boolean;
  reason: string | null;
}>;

export type AdvanceTransition = Readonly<{
  fromStage: number;
  toStage: number;
  kind: MesaAgendaBookingKind;
}>;

export type AdvanceBulkEligibility = BulkEligibility &
  Readonly<{
    transition: AdvanceTransition | null;
  }>;

export type BulkSelectionSummary = Readonly<{
  selectedBookingCount: number;
  uniqueExpedienteCount: number;
  eligibleDriveCount: number;
  /** Expedientes únicos (no bookings) elegibles para avance entre la selección. */
  eligibleAdvanceExpedienteCount: number;
  eligibleVisibleCount: number;
  selectedEligibleVisibleCount: number;
  headerState: "none" | "some" | "all";
  limitCapped: boolean;
  limitNotice: string | null;
}>;

export type SelectAllEligibleResult = Readonly<{
  nextSelected: ReadonlySet<string>;
  eligibleTotal: number;
  selectedCount: number;
  limitCapped: boolean;
  limitNotice: string | null;
}>;

function hasRole(role: string | null | undefined): boolean {
  return MESA_BULK_ALLOWED_ROLES.has(String(role ?? "").trim());
}

function hasBookingId(entry: MesaAgendaBookingEntry): boolean {
  return typeof entry.bookingId === "string" && entry.bookingId.trim() !== "";
}

function hasExpedienteId(entry: MesaAgendaBookingEntry): boolean {
  return typeof entry.expedienteId === "string" && entry.expedienteId.trim() !== "";
}

/** Instantánea local aproximada bookingDate+bookingTime (espejo predictivo de fecha_cita). */
export function mesaAgendaBookingInstantIso(
  entry: Pick<MesaAgendaBookingEntry, "bookingDate" | "bookingTime">,
): string | null {
  const date = String(entry.bookingDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = normalizeBookingTime(String(entry.bookingTime ?? "00:00"));
  const withSeconds = time.length === 5 ? `${time}:00` : time;
  return `${date}T${withSeconds}`;
}

export function getBulkDriveEligibility(
  entry: MesaAgendaBookingEntry,
  role: string | null | undefined,
): BulkEligibility {
  if (!hasRole(role)) {
    return { eligible: false, reason: "Sin permisos" };
  }
  if (!hasBookingId(entry)) {
    return { eligible: false, reason: "Cita sin identificador" };
  }
  if (entry.status !== "booked") {
    return { eligible: false, reason: "La cita no está activa" };
  }
  if (entry.driveValidated) {
    return { eligible: false, reason: "Drive ya validado" };
  }
  return { eligible: true, reason: null };
}

export function getBulkAdvanceEligibility(
  entry: MesaAgendaBookingEntry,
  role: string | null | undefined,
  nowMs: number = Date.now(),
): AdvanceBulkEligibility {
  if (!hasRole(role)) {
    return { eligible: false, reason: "Sin permisos", transition: null };
  }
  if (!hasExpedienteId(entry)) {
    return { eligible: false, reason: "Expediente sin identificador", transition: null };
  }
  if (!hasBookingId(entry)) {
    return { eligible: false, reason: "Cita sin identificador", transition: null };
  }
  if (entry.status !== "booked") {
    return { eligible: false, reason: "La cita no está activa", transition: null };
  }
  if (!entry.submittedToMesa) {
    return { eligible: false, reason: "Etapa no compatible", transition: null };
  }

  const etapa = entry.etapaActual;
  const kind = entry.kind;
  const sub = String(entry.subestado ?? "").trim();

  // Predictivo: no exige Drive. Sin cicloEstado en el listado (residual documentado).
  if (kind === "notificacion" && etapa === 3) {
    if (sub && sub !== "en_proceso") {
      return { eligible: false, reason: "Etapa no compatible", transition: null };
    }
    return {
      eligible: true,
      reason: null,
      transition: { fromStage: 3, toStage: 5, kind },
    };
  }

  if (kind === "biometricos" && etapa === 4) {
    return {
      eligible: true,
      reason: null,
      transition: { fromStage: 4, toStage: 5, kind },
    };
  }

  if (kind === "biometricos" && etapa === 5) {
    if (sub && sub !== "en_proceso") {
      return { eligible: false, reason: "Etapa no compatible", transition: null };
    }
    const iso = mesaAgendaBookingInstantIso(entry);
    if (!isFechaCitaBiometricaPasada(iso, nowMs)) {
      return {
        eligible: false,
        reason: "La cita todavía no ocurre",
        transition: null,
      };
    }
    return {
      eligible: true,
      reason: null,
      transition: { fromStage: 5, toStage: 6, kind },
    };
  }

  if (kind === "firmas" && etapa === 9) {
    if (sub && sub !== "en_proceso") {
      return { eligible: false, reason: "Etapa no compatible", transition: null };
    }
    return {
      eligible: true,
      reason: null,
      transition: { fromStage: 9, toStage: 10, kind },
    };
  }

  return { eligible: false, reason: "Etapa no compatible", transition: null };
}

export function isBulkSelectable(
  entry: MesaAgendaBookingEntry,
  role: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return (
    getBulkDriveEligibility(entry, role).eligible ||
    getBulkAdvanceEligibility(entry, role, nowMs).eligible
  );
}

export function formatBulkNotSelectableReason(
  entry: MesaAgendaBookingEntry,
  role: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  const drive = getBulkDriveEligibility(entry, role);
  const advance = getBulkAdvanceEligibility(entry, role, nowMs);
  const parts = [drive.reason, advance.reason].filter(
    (r, i, arr): r is string => Boolean(r) && arr.indexOf(r) === i,
  );
  if (parts.length === 0) {
    return "No disponible para acciones masivas.";
  }
  return `No disponible para acciones masivas: ${parts.join(" y ")}.`;
}

export function listEligibleVisibleBookingIds(
  visibleEntries: readonly MesaAgendaBookingEntry[],
  role: string | null | undefined,
  nowMs: number = Date.now(),
): string[] {
  const out: string[] = [];
  for (const entry of visibleEntries) {
    if (isBulkSelectable(entry, role, nowMs) && hasBookingId(entry)) {
      out.push(entry.bookingId);
    }
  }
  return out;
}

export function selectAllEligibleVisible(
  visibleEntries: readonly MesaAgendaBookingEntry[],
  role: string | null | undefined,
  nowMs: number = Date.now(),
  limit: number = MESA_BULK_SELECTION_LIMIT,
): SelectAllEligibleResult {
  const eligibleIds = listEligibleVisibleBookingIds(visibleEntries, role, nowMs);
  const capped = eligibleIds.slice(0, Math.max(0, limit));
  const limitCapped = eligibleIds.length > capped.length;
  return {
    nextSelected: new Set(capped),
    eligibleTotal: eligibleIds.length,
    selectedCount: capped.length,
    limitCapped,
    limitNotice: limitCapped
      ? MESA_BULK_LIMIT_NOTICE(capped.length, eligibleIds.length)
      : null,
  };
}

export function toggleBookingInSelection(
  selected: ReadonlySet<string>,
  bookingId: string,
  nextChecked: boolean,
  limit: number = MESA_BULK_SELECTION_LIMIT,
): ReadonlySet<string> {
  const id = bookingId.trim();
  if (!id) return selected;
  const next = new Set(selected);
  if (nextChecked) {
    if (next.has(id)) return selected;
    if (next.size >= limit) return selected;
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

export function reconcileBulkSelection(
  selected: ReadonlySet<string>,
  entries: readonly MesaAgendaBookingEntry[],
  role: string | null | undefined,
  nowMs: number = Date.now(),
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const byId = new Map(entries.map((e) => [e.bookingId, e]));
  const next = new Set<string>();
  for (const id of selected) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (!isBulkSelectable(entry, role, nowMs)) continue;
    next.add(id);
  }
  return next;
}

export function buildBulkSelectionSummary(
  visibleEntries: readonly MesaAgendaBookingEntry[],
  selectedBookingIds: ReadonlySet<string>,
  role: string | null | undefined,
  nowMs: number = Date.now(),
): BulkSelectionSummary {
  const eligibleIds = listEligibleVisibleBookingIds(visibleEntries, role, nowMs);
  const selectedEligibleVisibleCount = eligibleIds.filter((id) =>
    selectedBookingIds.has(id),
  ).length;

  let headerState: BulkSelectionSummary["headerState"] = "none";
  if (eligibleIds.length === 0 || selectedEligibleVisibleCount === 0) {
    headerState = "none";
  } else if (selectedEligibleVisibleCount >= Math.min(eligibleIds.length, MESA_BULK_SELECTION_LIMIT)) {
    // Con tope 100: "all" = todos los que caben en el límite de elegibles visibles.
    headerState = "all";
  } else {
    headerState = "some";
  }

  const selectedEntries = visibleEntries.filter((e) =>
    selectedBookingIds.has(e.bookingId),
  );
  const uniqueExpedientes = new Set(
    selectedEntries.map((e) => e.expedienteId).filter((id) => id.trim() !== ""),
  );

  let eligibleDriveCount = 0;
  const advanceExpedientes = new Set<string>();
  for (const entry of selectedEntries) {
    if (getBulkDriveEligibility(entry, role).eligible) eligibleDriveCount += 1;
    const adv = getBulkAdvanceEligibility(entry, role, nowMs);
    if (adv.eligible && hasExpedienteId(entry)) {
      advanceExpedientes.add(entry.expedienteId);
    }
  }

  const limitCapped =
    eligibleIds.length > MESA_BULK_SELECTION_LIMIT &&
    selectedEligibleVisibleCount === MESA_BULK_SELECTION_LIMIT &&
    selectedEligibleVisibleCount < eligibleIds.length;

  return {
    selectedBookingCount: selectedBookingIds.size,
    uniqueExpedienteCount: uniqueExpedientes.size,
    eligibleDriveCount,
    eligibleAdvanceExpedienteCount: advanceExpedientes.size,
    eligibleVisibleCount: eligibleIds.length,
    selectedEligibleVisibleCount,
    headerState,
    limitCapped,
    limitNotice: limitCapped
      ? MESA_BULK_LIMIT_NOTICE(MESA_BULK_SELECTION_LIMIT, eligibleIds.length)
      : null,
  };
}

export const MESA_BULK_DRIVE_CONCURRENCY = 5;

export type BulkDriveValidationResult = Readonly<{
  bookingId: string;
  expedienteId: string | null;
  success: boolean;
  reason: string | null;
  /** omitido antes de RPC vs fallido en RPC */
  status: "succeeded" | "failed" | "skipped";
}>;

export type BulkDriveValidationSummary = Readonly<{
  requested: number;
  eligible: number;
  skipped: number;
  succeeded: number;
  failed: number;
  results: readonly BulkDriveValidationResult[];
}>;

export type BulkDrivePlan = Readonly<{
  requested: number;
  eligibleEntries: readonly MesaAgendaBookingEntry[];
  skipped: readonly BulkDriveValidationResult[];
}>;

/** Planifica qué bookings se enviarán a la RPC (recalcula elegibilidad). */
export function planBulkDriveValidation(
  selectedBookingIds: ReadonlySet<string>,
  loadedEntries: readonly MesaAgendaBookingEntry[],
  role: string | null | undefined,
  limit: number = MESA_BULK_SELECTION_LIMIT,
): BulkDrivePlan {
  const byId = new Map(loadedEntries.map((e) => [e.bookingId, e]));
  const seen = new Set<string>();
  const skipped: BulkDriveValidationResult[] = [];
  const eligibleEntries: MesaAgendaBookingEntry[] = [];

  for (const rawId of selectedBookingIds) {
    const bookingId = String(rawId ?? "").trim();
    if (!bookingId || seen.has(bookingId)) continue;
    seen.add(bookingId);

    const entry = byId.get(bookingId);
    if (!entry) {
      skipped.push({
        bookingId,
        expedienteId: null,
        success: false,
        reason: "Cita no encontrada en el listado",
        status: "skipped",
      });
      continue;
    }

    const elig = getBulkDriveEligibility(entry, role);
    if (!elig.eligible) {
      skipped.push({
        bookingId,
        expedienteId: entry.expedienteId || null,
        success: false,
        reason: elig.reason ?? "No elegible",
        status: "skipped",
      });
      continue;
    }

    if (eligibleEntries.length >= limit) {
      skipped.push({
        bookingId,
        expedienteId: entry.expedienteId || null,
        success: false,
        reason: `Límite de ${limit} citas por operación`,
        status: "skipped",
      });
      continue;
    }

    eligibleEntries.push(entry);
  }

  return {
    requested: seen.size,
    eligibleEntries,
    skipped,
  };
}

export async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(runners);
  return results;
}

export async function executeBulkDriveValidation(params: Readonly<{
  selectedBookingIds: ReadonlySet<string>;
  loadedEntries: readonly MesaAgendaBookingEntry[];
  role: string | null | undefined;
  validate: (bookingId: string) => Promise<unknown>;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}>): Promise<BulkDriveValidationSummary> {
  const plan = planBulkDriveValidation(
    params.selectedBookingIds,
    params.loadedEntries,
    params.role,
  );
  const total = plan.eligibleEntries.length;
  let done = 0;
  params.onProgress?.(0, total);

  const rpcResults = await runWithConcurrencyLimit(
    plan.eligibleEntries,
    params.concurrency ?? MESA_BULK_DRIVE_CONCURRENCY,
    async (entry) => {
      try {
        await params.validate(entry.bookingId);
        done += 1;
        params.onProgress?.(done, total);
        return {
          bookingId: entry.bookingId,
          expedienteId: entry.expedienteId || null,
          success: true,
          reason: null,
          status: "succeeded" as const,
        };
      } catch (err) {
        done += 1;
        params.onProgress?.(done, total);
        const message =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : "No se pudo validar en Drive.";
        return {
          bookingId: entry.bookingId,
          expedienteId: entry.expedienteId || null,
          success: false,
          reason: message,
          status: "failed" as const,
        };
      }
    },
  );

  const results = [...plan.skipped, ...rpcResults];
  const succeeded = rpcResults.filter((r) => r.success).length;
  const failed = rpcResults.filter((r) => !r.success).length;

  return {
    requested: plan.requested,
    eligible: plan.eligibleEntries.length,
    skipped: plan.skipped.length,
    succeeded,
    failed,
    results,
  };
}

export function removeSuccessfulBookingsFromSelection(
  selected: ReadonlySet<string>,
  summary: BulkDriveValidationSummary,
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const succeeded = new Set(
    summary.results.filter((r) => r.status === "succeeded").map((r) => r.bookingId),
  );
  if (succeeded.size === 0) return selected;
  const next = new Set<string>();
  for (const id of selected) {
    if (!succeeded.has(id)) next.add(id);
  }
  return next;
}

export const MESA_BULK_ADVANCE_CONCURRENCY = MESA_BULK_DRIVE_CONCURRENCY;

export type BulkAdvancePlanItem = Readonly<{
  expedienteId: string;
  bookingIds: readonly string[];
  representativeBookingId: string;
  kind: MesaAgendaBookingKind | string;
  fromStage: number;
  toStage: number;
  eligible: boolean;
  reason: string | null;
}>;

export type BulkAdvancePlan = Readonly<{
  selectedBookings: number;
  uniqueExpedientes: number;
  eligibleExpedientes: number;
  skippedExpedientes: number;
  items: readonly BulkAdvancePlanItem[];
}>;

export type BulkAdvanceTransitionGroup = Readonly<{
  kind: string;
  fromStage: number;
  toStage: number;
  expedienteCount: number;
  items: readonly BulkAdvancePlanItem[];
}>;

export type BulkStageAdvanceResult = Readonly<{
  expedienteId: string;
  bookingIds: readonly string[];
  success: boolean;
  fromStage: number | null;
  toStage: number | null;
  kind: string | null;
  reason: string | null;
  status: "succeeded" | "failed" | "skipped";
}>;

export type BulkStageAdvanceSummary = Readonly<{
  selectedBookings: number;
  requestedExpedientes: number;
  eligibleExpedientes: number;
  skippedExpedientes: number;
  succeeded: number;
  failed: number;
  results: readonly BulkStageAdvanceResult[];
}>;

function transitionKey(
  kind: string,
  fromStage: number,
  toStage: number,
): string {
  return `${kind}|${fromStage}|${toStage}`;
}

function compareEntriesForRepresentative(
  a: MesaAgendaBookingEntry,
  b: MesaAgendaBookingEntry,
  orderIndex: ReadonlyMap<string, number>,
): number {
  const ia = orderIndex.get(a.bookingId) ?? Number.MAX_SAFE_INTEGER;
  const ib = orderIndex.get(b.bookingId) ?? Number.MAX_SAFE_INTEGER;
  if (ia !== ib) return ia - ib;
  const da = `${a.bookingDate}T${normalizeBookingTime(a.bookingTime)}`;
  const db = `${b.bookingDate}T${normalizeBookingTime(b.bookingTime)}`;
  if (da !== db) return da < db ? -1 : 1;
  return a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0;
}

function pickRepresentativeBooking(
  entries: readonly MesaAgendaBookingEntry[],
  orderIndex: ReadonlyMap<string, number>,
): MesaAgendaBookingEntry {
  const sorted = [...entries].sort((a, b) =>
    compareEntriesForRepresentative(a, b, orderIndex),
  );
  return sorted[0]!;
}

/** Planifica avance por expediente único (recalcula elegibilidad). */
export function planBulkStageAdvance(
  selectedBookingIds: ReadonlySet<string>,
  loadedEntries: readonly MesaAgendaBookingEntry[],
  role: string | null | undefined,
  nowMs: number = Date.now(),
  limit: number = MESA_BULK_SELECTION_LIMIT,
): BulkAdvancePlan {
  const byId = new Map(loadedEntries.map((e) => [e.bookingId, e]));
  const orderIndex = new Map(loadedEntries.map((e, i) => [e.bookingId, i]));
  const seenBooking = new Set<string>();
  const groups = new Map<string, MesaAgendaBookingEntry[]>();
  const groupOrder: string[] = [];

  let selectedCount = 0;
  for (const rawId of selectedBookingIds) {
    const bookingId = String(rawId ?? "").trim();
    if (!bookingId || seenBooking.has(bookingId)) continue;
    seenBooking.add(bookingId);
    selectedCount += 1;

    if (selectedCount > limit) {
      continue;
    }

    const entry = byId.get(bookingId);
    if (!entry || !hasExpedienteId(entry)) continue;

    const expId = entry.expedienteId.trim();
    const list = groups.get(expId);
    if (list) {
      list.push(entry);
    } else {
      groups.set(expId, [entry]);
      groupOrder.push(expId);
    }
  }

  const items: BulkAdvancePlanItem[] = [];

  for (const expedienteId of groupOrder) {
    const entries = groups.get(expedienteId) ?? [];
    const bookingIds = entries.map((e) => e.bookingId);
    const representative = pickRepresentativeBooking(entries, orderIndex);

    const eligibleEntries: MesaAgendaBookingEntry[] = [];
    const transitions = new Map<string, AdvanceTransition>();
    let firstIneligibleReason: string | null = null;

    for (const entry of entries) {
      const elig = getBulkAdvanceEligibility(entry, role, nowMs);
      if (!elig.eligible || !elig.transition) {
        if (!firstIneligibleReason) {
          firstIneligibleReason = elig.reason ?? "No elegible";
        }
        continue;
      }
      eligibleEntries.push(entry);
      const key = transitionKey(
        elig.transition.kind,
        elig.transition.fromStage,
        elig.transition.toStage,
      );
      transitions.set(key, elig.transition);
    }

    if (eligibleEntries.length === 0) {
      items.push({
        expedienteId,
        bookingIds,
        representativeBookingId: representative.bookingId,
        kind: representative.kind,
        fromStage: representative.etapaActual,
        toStage: representative.etapaActual,
        eligible: false,
        reason: firstIneligibleReason ?? "No elegible",
      });
      continue;
    }

    if (transitions.size > 1) {
      items.push({
        expedienteId,
        bookingIds,
        representativeBookingId: representative.bookingId,
        kind: representative.kind,
        fromStage: representative.etapaActual,
        toStage: representative.etapaActual,
        eligible: false,
        reason: "El expediente tiene citas seleccionadas con transiciones distintas",
      });
      continue;
    }

    const transition = [...transitions.values()][0]!;
    const repEligible = pickRepresentativeBooking(eligibleEntries, orderIndex);
    items.push({
      expedienteId,
      bookingIds,
      representativeBookingId: repEligible.bookingId,
      kind: transition.kind,
      fromStage: transition.fromStage,
      toStage: transition.toStage,
      eligible: true,
      reason: null,
    });
  }

  const eligibleExpedientes = items.filter((i) => i.eligible).length;
  return {
    selectedBookings: Math.min(selectedCount, limit),
    uniqueExpedientes: items.length,
    eligibleExpedientes,
    skippedExpedientes: items.length - eligibleExpedientes,
    items,
  };
}

export function groupBulkAdvancePlanByTransition(
  plan: BulkAdvancePlan,
): readonly BulkAdvanceTransitionGroup[] {
  const map = new Map<string, BulkAdvancePlanItem[]>();
  const order: string[] = [];
  for (const item of plan.items) {
    if (!item.eligible) continue;
    const key = transitionKey(String(item.kind), item.fromStage, item.toStage);
    const list = map.get(key);
    if (list) {
      list.push(item);
    } else {
      map.set(key, [item]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const items = map.get(key) ?? [];
    const first = items[0]!;
    return {
      kind: String(first.kind),
      fromStage: first.fromStage,
      toStage: first.toStage,
      expedienteCount: items.length,
      items,
    };
  });
}

export function mapBulkAdvanceFailureReason(err: unknown): string {
  const message =
    err instanceof Error && err.message.trim()
      ? err.message.trim()
      : "No se pudo avanzar la etapa del expediente.";
  const lower = message.toLowerCase();
  if (
    lower.includes("no hay una transición de etapa disponible") ||
    lower.includes("solo se puede continuar desde la etapa") ||
    lower.includes("transición no soportada") ||
    lower.includes("cambió de etapa")
  ) {
    return "El expediente cambió de etapa antes de procesarse.";
  }
  return message;
}

export async function executeBulkStageAdvance(params: Readonly<{
  selectedBookingIds: ReadonlySet<string>;
  loadedEntries: readonly MesaAgendaBookingEntry[];
  role: string | null | undefined;
  nowMs?: number;
  advance: (expedienteId: string) => Promise<unknown>;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}>): Promise<BulkStageAdvanceSummary> {
  const plan = planBulkStageAdvance(
    params.selectedBookingIds,
    params.loadedEntries,
    params.role,
    params.nowMs ?? Date.now(),
  );
  const eligible = plan.items.filter((i) => i.eligible);
  const skippedItems = plan.items.filter((i) => !i.eligible);
  const total = eligible.length;
  let done = 0;
  params.onProgress?.(0, total);

  const rpcResults = await runWithConcurrencyLimit(
    eligible,
    params.concurrency ?? MESA_BULK_ADVANCE_CONCURRENCY,
    async (item) => {
      try {
        await params.advance(item.expedienteId);
        done += 1;
        params.onProgress?.(done, total);
        return {
          expedienteId: item.expedienteId,
          bookingIds: item.bookingIds,
          success: true,
          fromStage: item.fromStage,
          toStage: item.toStage,
          kind: String(item.kind),
          reason: null,
          status: "succeeded" as const,
        };
      } catch (err) {
        done += 1;
        params.onProgress?.(done, total);
        return {
          expedienteId: item.expedienteId,
          bookingIds: item.bookingIds,
          success: false,
          fromStage: item.fromStage,
          toStage: item.toStage,
          kind: String(item.kind),
          reason: mapBulkAdvanceFailureReason(err),
          status: "failed" as const,
        };
      }
    },
  );

  const skippedResults: BulkStageAdvanceResult[] = skippedItems.map((item) => ({
    expedienteId: item.expedienteId,
    bookingIds: item.bookingIds,
    success: false,
    fromStage: item.fromStage,
    toStage: item.toStage,
    kind: String(item.kind),
    reason: item.reason,
    status: "skipped" as const,
  }));

  return {
    selectedBookings: plan.selectedBookings,
    requestedExpedientes: plan.uniqueExpedientes,
    eligibleExpedientes: plan.eligibleExpedientes,
    skippedExpedientes: plan.skippedExpedientes,
    succeeded: rpcResults.filter((r) => r.success).length,
    failed: rpcResults.filter((r) => !r.success).length,
    results: [...skippedResults, ...rpcResults],
  };
}

export function removeSuccessfulExpedientesFromSelection(
  selected: ReadonlySet<string>,
  summary: BulkStageAdvanceSummary,
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const remove = new Set<string>();
  for (const r of summary.results) {
    if (r.status !== "succeeded") continue;
    for (const id of r.bookingIds) remove.add(id);
  }
  if (remove.size === 0) return selected;
  const next = new Set<string>();
  for (const id of selected) {
    if (!remove.has(id)) next.add(id);
  }
  return next;
}

export function mesaAgendaKindBulkLabel(kind: string): string {
  switch (kind) {
    case "notificacion":
      return "notificación";
    case "biometricos":
      return "biométricos";
    case "firmas":
      return "firmas";
    default:
      return kind;
  }
}
