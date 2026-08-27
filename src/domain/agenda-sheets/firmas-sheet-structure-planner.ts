/**
 * Planificador READ-ONLY de estructura Sheet Firmas (P212 Fase 1).
 * Genera PLAN sin writes. Adapter de memoria para tests locales.
 */

export type SheetSectionKind = "firmas" | "biometricos" | "inscripcion";
export type SheetSede = "monterrey" | "apodaca";

export type SheetSectionRef = Readonly<{
  sede: SheetSede;
  kind: SheetSectionKind;
}>;

export type SheetSectionBoundary = Readonly<{
  section: SheetSectionRef;
  headerRow: number;
  firstDataRow: number | null;
  lastDataRow: number | null;
  nextSectionRow: number | null;
}>;

export type SheetRowClassification =
  | "blank_template"
  | "legacy_active"
  | "has_b_d"
  | "has_e_n"
  | "has_o_u"
  | "linked_claimed"
  | "occupied_external"
  | "conflict"
  | "human_result"
  | "section_header"
  | "other";

export type SheetRowAnalysis = Readonly<{
  row: number;
  section: SheetSectionRef | null;
  slotTime: string | null;
  classification: SheetRowClassification;
  reusableForNewSlot: boolean;
  slotKey: string | null;
  bookingId: string | null;
  expedienteId: string | null;
}>;

export type BiometricRowChecksum = Readonly<{
  sheetId: number;
  sheetTitle: string;
  row: number;
  colA: string;
  bdHash: string;
  enHash: string;
  ouHash: string;
  slotKey: string | null;
  bookingId: string | null;
  expedienteId: string | null;
}>;

export type FirmasSlotTarget = Readonly<{
  sede: SheetSede;
  slotTime: "08:00" | "09:00" | "10:00";
  requiredPhysicalRows: 5;
}>;

export const FIRMAS_TARGET_SLOTS: readonly FirmasSlotTarget[] = [
  { sede: "monterrey", slotTime: "08:00", requiredPhysicalRows: 5 },
  { sede: "monterrey", slotTime: "09:00", requiredPhysicalRows: 5 },
  { sede: "monterrey", slotTime: "10:00", requiredPhysicalRows: 5 },
  { sede: "apodaca", slotTime: "08:00", requiredPhysicalRows: 5 },
  { sede: "apodaca", slotTime: "09:00", requiredPhysicalRows: 5 },
  { sede: "apodaca", slotTime: "10:00", requiredPhysicalRows: 5 },
] as const;

export type FirmasStructurePlanAction =
  | Readonly<{ type: "reuse_row"; row: number; sede: SheetSede; slotTime: string }>
  | Readonly<{ type: "append_row"; afterRow: number; sede: SheetSede; slotTime: string }>
  | Readonly<{ type: "copy_template_from"; templateRow: number; targetRow: number; sede: SheetSede; slotTime: string }>;

export type FirmasStructurePlan = Readonly<{
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  sections: readonly SheetSectionBoundary[];
  rowAnalyses: readonly SheetRowAnalysis[];
  biometricPreChecksums: readonly BiometricRowChecksum[];
  actions: readonly FirmasStructurePlanAction[];
  canExpandNoShift: boolean;
  rejectReason: string | null;
  targetRowsBySede: Readonly<Record<SheetSede, number>>;
  protectedRows: readonly number[];
}>;

export type SheetGridReadAdapter = Readonly<{
  getValues: (range: string) => Promise<string[][]>;
  listSheets?: () => Promise<readonly { sheetId: number; title: string }[]>;
}>;

export type MemorySheetTab = Readonly<{
  sheetId: number;
  title: string;
  grid: string[][];
}>;

export function createMemorySheetAdapter(
  tabs: readonly MemorySheetTab[],
): SheetGridReadAdapter {
  const byTitle = new Map(tabs.map((t) => [t.title, t]));
  return {
    async getValues(range: string): Promise<string[][]> {
      const m = /^'([^']*)'!/.exec(range) ?? /^([^!]+)!/.exec(range);
      const title = m?.[1]?.replace(/''/g, "'") ?? "";
      const tab = byTitle.get(title);
      if (!tab) return [];
      return tab.grid.map((row) => [...row]);
    },
    async listSheets() {
      return tabs.map((t) => ({ sheetId: t.sheetId, title: t.title }));
    },
  };
}

export function parseSection(cellA: string): SheetSectionRef | null {
  const n = String(cellA ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  const map: Record<string, SheetSectionRef> = {
    "MONTERREY FIRMAS": { sede: "monterrey", kind: "firmas" },
    "MONTERREY BIOMETRICOS": { sede: "monterrey", kind: "biometricos" },
    "MONTERREY INSCRIPCION": { sede: "monterrey", kind: "inscripcion" },
    "APODACA FIRMAS": { sede: "apodaca", kind: "firmas" },
    "APODACA BIOMETRICOS": { sede: "apodaca", kind: "biometricos" },
    "APODACA INSCRIPCION": { sede: "apodaca", kind: "inscripcion" },
  };
  return map[n] ?? null;
}

export function parseTime(raw: string): string | null {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bA\.\s*M\.?/gi, "AM")
    .replace(/\bP\.\s*M\.?/gi, "PM")
    .toUpperCase();
  const m =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(t) ??
    /^(\d{1,2}):(\d{2})(AM|PM)$/i.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = (m[3] ?? "").toUpperCase();
  if (minute < 0 || minute > 59) return null;
  if (ampm === "AM" || ampm === "PM") {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) hour += 12;
  } else if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function colSlice(row: readonly string[], from: number, toInclusive: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= toInclusive; i++) {
    out.push(String(row[i] ?? "").trim());
  }
  return out;
}

export function sanitizeHash(parts: readonly string[]): string {
  return parts
    .map((p) =>
      String(p ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase(),
    )
    .join("|");
}

function hasNonEmpty(parts: readonly string[]): boolean {
  return parts.some((p) => String(p ?? "").trim() !== "");
}

function parseMetadataOu(row: readonly string[]): {
  slotKey: string | null;
  bookingId: string | null;
  expedienteId: string | null;
} {
  const ou = colSlice(row, 14, 20);
  const slotKey = ou[0] || null;
  const bookingId = ou[2] || null;
  const expedienteId = ou[3] || null;
  return { slotKey, bookingId, expedienteId };
}

function classifyRow(
  rowNum: number,
  row: readonly string[],
  section: SheetSectionRef | null,
  linkedRows: ReadonlySet<number>,
): SheetRowAnalysis {
  const colA = String(row[0] ?? "").trim();
  const header = parseSection(colA);
  if (header) {
    return {
      row: rowNum,
      section: header,
      slotTime: null,
      classification: "section_header",
      reusableForNewSlot: false,
      slotKey: null,
      bookingId: null,
      expedienteId: null,
    };
  }

  const slotTime = parseTime(colA);
  const bd = colSlice(row, 1, 3);
  const en = colSlice(row, 4, 13);
  const ou = parseMetadataOu(row);
  const hasBd = hasNonEmpty(bd);
  const hasEn = hasNonEmpty(en);
  const hasOu = hasNonEmpty(colSlice(row, 14, 20));

  if (linkedRows.has(rowNum)) {
    return {
      row: rowNum,
      section,
      slotTime,
      classification: "linked_claimed",
      reusableForNewSlot: false,
      slotKey: ou.slotKey,
      bookingId: ou.bookingId,
      expedienteId: ou.expedienteId,
    };
  }

  if (hasOu && (ou.bookingId || ou.expedienteId || ou.slotKey)) {
    return {
      row: rowNum,
      section,
      slotTime,
      classification: "linked_claimed",
      reusableForNewSlot: false,
      slotKey: ou.slotKey,
      bookingId: ou.bookingId,
      expedienteId: ou.expedienteId,
    };
  }

  if (hasBd) {
    return {
      row: rowNum,
      section,
      slotTime,
      classification: "has_b_d",
      reusableForNewSlot: false,
      slotKey: ou.slotKey,
      bookingId: ou.bookingId,
      expedienteId: ou.expedienteId,
    };
  }

  if (hasEn) {
    return {
      row: rowNum,
      section,
      slotTime,
      classification: "has_e_n",
      reusableForNewSlot: false,
      slotKey: ou.slotKey,
      bookingId: ou.bookingId,
      expedienteId: ou.expedienteId,
    };
  }

  if (hasOu) {
    return {
      row: rowNum,
      section,
      slotTime,
      classification: "has_o_u",
      reusableForNewSlot: false,
      slotKey: ou.slotKey,
      bookingId: ou.bookingId,
      expedienteId: ou.expedienteId,
    };
  }

  if (slotTime && section?.kind === "firmas") {
    const legacyTimes = new Set(["08:30", "09:30", "10:30", "11:00"]);
    if (legacyTimes.has(slotTime)) {
      return {
        row: rowNum,
        section,
        slotTime,
        classification: "legacy_active",
        reusableForNewSlot: false,
        slotKey: ou.slotKey,
        bookingId: ou.bookingId,
        expedienteId: ou.expedienteId,
      };
    }
  }

  if (!colA && !hasBd && !hasEn && !hasOu) {
    return {
      row: rowNum,
      section,
      slotTime: null,
      classification: "blank_template",
      reusableForNewSlot: section?.kind === "firmas",
      slotKey: null,
      bookingId: null,
      expedienteId: null,
    };
  }

  return {
    row: rowNum,
    section,
    slotTime,
    classification: "other",
    reusableForNewSlot: false,
    slotKey: ou.slotKey,
    bookingId: ou.bookingId,
    expedienteId: ou.expedienteId,
  };
}

export function analyzeSheetGrid(input: {
  sheetId: number;
  sheetTitle: string;
  grid: readonly (readonly string[])[];
  linkedRows?: ReadonlySet<number>;
}): {
  sections: SheetSectionBoundary[];
  rowAnalyses: SheetRowAnalysis[];
  biometricPreChecksums: BiometricRowChecksum[];
} {
  const linkedRows = input.linkedRows ?? new Set<number>();
  let currentSection: SheetSectionRef | null = null;
  void currentSection;
  const sectionStarts: { row: number; section: SheetSectionRef }[] = [];

  for (let i = 0; i < input.grid.length; i++) {
    const row = input.grid[i] ?? [];
    const header = parseSection(String(row[0] ?? ""));
    if (header) {
      currentSection = header;
      sectionStarts.push({ row: i + 1, section: header });
    }
  }

  const sections: SheetSectionBoundary[] = [];
  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s]!;
    const endRow =
      s + 1 < sectionStarts.length ? sectionStarts[s + 1]!.row - 1 : input.grid.length;
    let firstData: number | null = null;
    let lastData: number | null = null;
    for (let r = start.row + 1; r <= endRow; r++) {
      const row = input.grid[r - 1] ?? [];
      const colA = String(row[0] ?? "").trim();
      if (!colA && !hasNonEmpty(colSlice(row, 1, 20))) continue;
      if (parseSection(colA)) continue;
      if (firstData === null) firstData = r;
      lastData = r;
    }
    sections.push({
      section: start.section,
      headerRow: start.row,
      firstDataRow: firstData,
      lastDataRow: lastData,
      nextSectionRow: s + 1 < sectionStarts.length ? sectionStarts[s + 1]!.row : null,
    });
  }

  const rowAnalyses: SheetRowAnalysis[] = [];
  const biometricPreChecksums: BiometricRowChecksum[] = [];

  for (let i = 0; i < input.grid.length; i++) {
    const rowNum = i + 1;
    const row = input.grid[i] ?? [];
    let activeSection: SheetSectionRef | null = null;
    for (const sec of sections) {
      if (rowNum > sec.headerRow && (sec.nextSectionRow === null || rowNum < sec.nextSectionRow)) {
        activeSection = sec.section;
      }
    }
    const base = classifyRow(rowNum, row, activeSection, linkedRows);
    const analysis: SheetRowAnalysis = { ...base, section: activeSection };
    rowAnalyses.push(analysis);

    if (activeSection?.kind === "biometricos") {
      const bd = colSlice(row, 1, 3);
      const en = colSlice(row, 4, 13);
      const ou = colSlice(row, 14, 20);
      const meta = parseMetadataOu(row);
      biometricPreChecksums.push({
        sheetId: input.sheetId,
        sheetTitle: input.sheetTitle,
        row: rowNum,
        colA: String(row[0] ?? "").trim(),
        bdHash: sanitizeHash(bd),
        enHash: sanitizeHash(en),
        ouHash: sanitizeHash(ou),
        slotKey: meta.slotKey,
        bookingId: meta.bookingId,
        expedienteId: meta.expedienteId,
      });
    }
  }

  return { sections, rowAnalyses, biometricPreChecksums };
}

export function compareBiometricChecksums(
  pre: readonly BiometricRowChecksum[],
  post: readonly BiometricRowChecksum[],
): { changedRows: number; mismatches: readonly { row: number; field: string }[] } {
  const preByRow = new Map(pre.map((p) => [p.row, p]));
  const mismatches: { row: number; field: string }[] = [];
  for (const after of post) {
    const before = preByRow.get(after.row);
    if (!before) {
      mismatches.push({ row: after.row, field: "missing_pre" });
      continue;
    }
    for (const field of ["colA", "bdHash", "enHash", "ouHash", "slotKey", "bookingId", "expedienteId"] as const) {
      if (before[field] !== after[field]) {
        mismatches.push({ row: after.row, field });
      }
    }
  }
  for (const before of pre) {
    if (!post.some((p) => p.row === before.row)) {
      mismatches.push({ row: before.row, field: "missing_post" });
    }
  }
  return { changedRows: mismatches.length, mismatches };
}

function firmasSectionBoundary(
  sections: readonly SheetSectionBoundary[],
  sede: SheetSede,
): SheetSectionBoundary | null {
  return sections.find((s) => s.section.kind === "firmas" && s.section.sede === sede) ?? null;
}

function countExistingTargetRows(
  analyses: readonly SheetRowAnalysis[],
  sede: SheetSede,
  slotTime: string,
): number {
  return analyses.filter(
    (a) =>
      a.section?.kind === "firmas" &&
      a.section.sede === sede &&
      a.slotTime === slotTime &&
      !a.reusableForNewSlot &&
      a.classification !== "section_header",
  ).length;
}

export function buildFirmasStructurePlan(input: {
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  grid: readonly (readonly string[])[];
  linkedRows?: ReadonlySet<number>;
}): FirmasStructurePlan {
  const { sections, rowAnalyses, biometricPreChecksums } = analyzeSheetGrid(input);
  const actions: FirmasStructurePlanAction[] = [];
  const protectedRows = rowAnalyses
    .filter(
      (r) =>
        r.classification === "linked_claimed" ||
        r.classification === "has_b_d" ||
        r.classification === "has_e_n" ||
        r.classification === "has_o_u" ||
        r.classification === "legacy_active" ||
        r.classification === "occupied_external" ||
        r.classification === "conflict" ||
        r.section?.kind === "biometricos",
    )
    .map((r) => r.row);

  let rejectReason: string | null = null;
  let canExpandNoShift = true;

  const targetRowsBySede: Record<SheetSede, number> = { monterrey: 0, apodaca: 0 };

  for (const target of FIRMAS_TARGET_SLOTS) {
    targetRowsBySede[target.sede] += target.requiredPhysicalRows;
    const boundary = firmasSectionBoundary(sections, target.sede);
    if (!boundary) {
      rejectReason = `Sección ${target.sede.toUpperCase()} FIRMAS no encontrada`;
      canExpandNoShift = false;
      continue;
    }

    const existing = countExistingTargetRows(rowAnalyses, target.sede, target.slotTime);
    const needed = Math.max(0, target.requiredPhysicalRows - existing);

    const reusable = rowAnalyses.filter(
      (r) =>
        r.section?.kind === "firmas" &&
        r.section.sede === target.sede &&
        r.reusableForNewSlot &&
        (r.slotTime === target.slotTime || r.slotTime === null),
    );

    let assigned = 0;
    for (const row of reusable) {
      if (assigned >= needed) break;
      actions.push({
        type: "reuse_row",
        row: row.row,
        sede: target.sede,
        slotTime: target.slotTime,
      });
      assigned += 1;
    }

    const stillNeed = needed - assigned;
    if (stillNeed <= 0) continue;

    // P212 Fase 1.5: insertDimension / append que desplace secciones = PROHIBIDO.
    // Solo reutilizar filas blank ya físicas dentro del bloque Firmas cuenta como NO-SHIFT.
    const gapBlanks = rowAnalyses.filter(
      (r) =>
        r.section?.kind === "firmas" &&
        r.section.sede === target.sede &&
        r.classification === "blank_template" &&
        !actions.some(
          (a) => a.type === "reuse_row" && a.row === r.row,
        ),
    );
    if (gapBlanks.length >= stillNeed) {
      for (let n = 0; n < stillNeed; n++) {
        const row = gapBlanks[n]!;
        actions.push({
          type: "reuse_row",
          row: row.row,
          sede: target.sede,
          slotTime: target.slotTime,
        });
      }
      continue;
    }

    rejectReason =
      `NO_SAFE_CAPACITY: ${target.sede} Firmas ${target.slotTime} faltan ${stillNeed} filas ` +
      `sin espacio blank reutilizable (insertDimension/append que desplace Biométricos = STOP)`;
    canExpandNoShift = false;
  }

  return {
    sheetId: input.sheetId,
    sheetTitle: input.sheetTitle,
    bookingDate: input.bookingDate,
    sections,
    rowAnalyses,
    biometricPreChecksums,
    actions,
    canExpandNoShift,
    rejectReason,
    targetRowsBySede,
    protectedRows,
  };
}

export async function generateFirmasStructurePlanFromAdapter(input: {
  adapter: SheetGridReadAdapter;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  linkedRows?: ReadonlySet<number>;
}): Promise<FirmasStructurePlan> {
  const titleEsc = `'${input.sheetTitle.replace(/'/g, "''")}'`;
  const grid = await input.adapter.getValues(`${titleEsc}!A1:U200`);
  return buildFirmasStructurePlan({
    sheetId: input.sheetId,
    sheetTitle: input.sheetTitle,
    bookingDate: input.bookingDate,
    grid,
    linkedRows: input.linkedRows,
  });
}
