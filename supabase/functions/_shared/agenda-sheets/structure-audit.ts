/**
 * P212 Fase 1.7 — auditoría estructural Firmas A:U (redacción + fingerprints).
 * Sin PII cruda en B:U salvo columna A (hora/header estructural).
 */

export const STRUCTURE_AUDIT_COLS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
] as const;

export type StructureAuditCol = (typeof STRUCTURE_AUDIT_COLS)[number];

export type CellValueKind =
  | "blank"
  | "string"
  | "number"
  | "bool"
  | "formula"
  | "error"
  | "other";

export type RedactedCellAudit = Readonly<{
  col: StructureAuditCol;
  isBlank: boolean;
  hasFormula: boolean;
  hasValidation: boolean;
  hasNote: boolean;
  valueType: CellValueKind;
  effectiveValueType: CellValueKind;
  /** Solo columna A: texto estructural (hora/header). */
  structuralTextA: string | null;
  numberFormat: string | null;
  horizontalAlignment: string | null;
  verticalAlignment: string | null;
  wrapStrategy: string | null;
  /** Alias histórico (= effectiveFormatFingerprint). */
  formatFingerprint: string;
  userFormatFingerprint: string;
  effectiveFormatFingerprint: string;
  validationFingerprint: string | null;
}>;

export type RedactedRowAudit = Readonly<{
  row_number: number;
  pixelSize: number | null;
  hidden: boolean;
  cells: readonly RedactedCellAudit[];
  rowFormatFingerprint: string;
  rowValidationFingerprint: string;
  /** B:D / E:N / O:U occupancy signals (sin valores). */
  bdOccupied: boolean;
  enHasHumanResult: boolean;
  ouHasBookingMeta: boolean;
}>;

export type HeaderAudit = Readonly<{
  row_number: number;
  titleStructural: string;
  sede: "monterrey" | "apodaca" | null;
  pixelSize: number | null;
  mergeRanges: readonly Readonly<{
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  }>[];
  columnSpanHint: number | null;
  formatFingerprint: string;
  hasValidation: boolean;
  cells: readonly RedactedCellAudit[];
}>;

export type FirmasTemplatePick = Readonly<{
  sede: "monterrey" | "apodaca";
  sourceTemplateRow: number | null;
  candidateRows: readonly number[];
  sameTemplateAcrossTargetHours: boolean | null;
  hoursCompared: readonly string[];
  reason: string;
}>;

type RawUv = Record<string, unknown> | null | undefined;

function valueKind(v: RawUv): CellValueKind {
  if (!v || typeof v !== "object") return "blank";
  if ("formulaValue" in v) return "formula";
  if ("stringValue" in v) {
    const s = String((v as { stringValue?: unknown }).stringValue ?? "");
    return s.trim() === "" ? "blank" : "string";
  }
  if ("numberValue" in v) return "number";
  if ("boolValue" in v) return "bool";
  if ("errorValue" in v) return "error";
  return Object.keys(v).length === 0 ? "blank" : "other";
}

function isBlankValue(v: RawUv): boolean {
  return valueKind(v) === "blank";
}

function stableJson(x: unknown): string {
  if (x == null) return "null";
  if (typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stableJson).join(",")}]`;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

/** FNV-1a 32-bit — fingerprint corto, no crypto. */
export function fingerprint(payload: unknown): string {
  const s = stableJson(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `f${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function formatBits(ef: RawUv): Record<string, unknown> {
  if (!ef || typeof ef !== "object") return {};
  const e = ef as Record<string, unknown>;
  return {
    bg: e.backgroundColor ?? e.backgroundColorStyle ?? null,
    borders: e.borders ?? null,
    ha: e.horizontalAlignment ?? null,
    va: e.verticalAlignment ?? null,
    wrap: e.wrapStrategy ?? null,
    nf: (e.numberFormat as { type?: string; pattern?: string } | undefined) ?? null,
    tf: e.textFormat ?? null,
  };
}

function validationBits(dv: RawUv): Record<string, unknown> | null {
  if (!dv || typeof dv !== "object") return null;
  const d = dv as Record<string, unknown>;
  // No copiar valores de lista crudos si parecen PII; solo tipo/condición.
  return {
    conditionType: (d.condition as { type?: string } | undefined)?.type ?? null,
    strict: d.strict ?? null,
    showCustomUi: d.showCustomUi ?? null,
  };
}

export function colLetter(index0: number): StructureAuditCol | null {
  return STRUCTURE_AUDIT_COLS[index0] ?? null;
}

export function redactCell(
  colIndex0: number,
  raw: {
    userEnteredValue?: RawUv;
    effectiveValue?: RawUv;
    userEnteredFormat?: RawUv;
    effectiveFormat?: RawUv;
    dataValidation?: RawUv;
    note?: string;
  } | null | undefined,
): RedactedCellAudit | null {
  const col = colLetter(colIndex0);
  if (!col) return null;
  const ue = raw?.userEnteredValue;
  const ev = raw?.effectiveValue;
  const uf = raw?.userEnteredFormat;
  const ef = raw?.effectiveFormat ?? uf;
  const dv = raw?.dataValidation;
  const hasFormula = valueKind(ue) === "formula";
  const vt = valueKind(ue);
  const evt = valueKind(ev);
  const blank = isBlankValue(ue) && isBlankValue(ev);
  const fmtUser = formatBits(uf);
  const fmtEff = formatBits(ef);
  const nf = (ef as { numberFormat?: { type?: string; pattern?: string } } | undefined)
    ?.numberFormat;
  const vBits = validationBits(dv);
  let structuralTextA: string | null = null;
  if (col === "A") {
    const s =
      typeof (ue as { stringValue?: unknown } | undefined)?.stringValue === "string"
        ? String((ue as { stringValue: string }).stringValue)
        : typeof (ev as { stringValue?: unknown } | undefined)?.stringValue === "string"
          ? String((ev as { stringValue: string }).stringValue)
          : "";
    structuralTextA = s.trim() || null;
  }
  const userFp = fingerprint(fmtUser);
  const effFp = fingerprint(fmtEff);
  return {
    col,
    isBlank: blank,
    hasFormula,
    hasValidation: Boolean(dv),
    hasNote: Boolean(raw?.note && String(raw.note).trim()),
    valueType: vt,
    effectiveValueType: evt,
    structuralTextA,
    numberFormat: nf?.type ? `${nf.type}:${nf.pattern ?? ""}` : null,
    horizontalAlignment: (ef as { horizontalAlignment?: string } | undefined)
      ?.horizontalAlignment ?? null,
    verticalAlignment: (ef as { verticalAlignment?: string } | undefined)
      ?.verticalAlignment ?? null,
    wrapStrategy: (ef as { wrapStrategy?: string } | undefined)?.wrapStrategy ?? null,
    formatFingerprint: effFp,
    userFormatFingerprint: userFp,
    effectiveFormatFingerprint: effFp,
    validationFingerprint: vBits ? fingerprint(vBits) : null,
  };
}

function cellBandOccupied(
  cells: readonly RedactedCellAudit[],
  from: StructureAuditCol,
  to: StructureAuditCol,
): boolean {
  const a = STRUCTURE_AUDIT_COLS.indexOf(from);
  const b = STRUCTURE_AUDIT_COLS.indexOf(to);
  for (let i = a; i <= b; i++) {
    const c = cells[i];
    if (!c) continue;
    if (!c.isBlank || c.hasFormula) return true;
  }
  return false;
}

export function redactRow(input: {
  row_number: number;
  pixelSize: number | null;
  hidden: boolean;
  values: ReadonlyArray<{
    userEnteredValue?: RawUv;
    effectiveValue?: RawUv;
    userEnteredFormat?: RawUv;
    effectiveFormat?: RawUv;
    dataValidation?: RawUv;
    note?: string;
  } | null | undefined>;
}): RedactedRowAudit {
  const cells: RedactedCellAudit[] = [];
  for (let i = 0; i < 21; i++) {
    const c = redactCell(i, input.values[i] ?? null);
    if (c) cells.push(c);
  }
  const rowFormatFingerprint = fingerprint(
    cells.map((c) => ({ col: c.col, f: c.formatFingerprint, nf: c.numberFormat })),
  );
  const rowValidationFingerprint = fingerprint(
    cells.map((c) => ({
      col: c.col,
      v: c.validationFingerprint,
      has: c.hasValidation,
    })),
  );
  return {
    row_number: input.row_number,
    pixelSize: input.pixelSize,
    hidden: input.hidden,
    cells,
    rowFormatFingerprint,
    rowValidationFingerprint,
    bdOccupied: cellBandOccupied(cells, "B", "D"),
    enHasHumanResult: cellBandOccupied(cells, "E", "N"),
    ouHasBookingMeta: cellBandOccupied(cells, "O", "U"),
  };
}

export function isReusableFirmasTemplateRow(row: RedactedRowAudit): boolean {
  if (row.hidden) return false;
  if (row.bdOccupied) return false;
  if (row.enHasHumanResult) return false;
  if (row.ouHasBookingMeta) return false;
  const a = row.cells[0]?.structuralTextA?.trim() ?? "";
  // Debe tener hora estructural en A (no header de sección).
  return /^\d{1,2}:\d{2}/.test(a) || /\d{1,2}:\d{2}\s*(AM|PM)/i.test(a);
}

/** Fila con hora A usable como FUENTE DE FORMATO (ocupada OK; no se copian values). */
export function isFormatSourceFirmasRow(row: RedactedRowAudit): boolean {
  if (row.hidden) return false;
  const a = row.cells[0]?.structuralTextA?.trim() ?? "";
  return /^\d{1,2}:\d{2}/.test(a) || /\d{1,2}:\d{2}\s*(AM|PM)/i.test(a);
}

export type TemplateContractColumn = Readonly<{
  column: StructureAuditCol;
  hasValue: boolean;
  valueType: CellValueKind;
  hasFormula: boolean;
  hasValidation: boolean;
  validationFingerprint: string | null;
  userFormatFingerprint: string;
  effectiveFormatFingerprint: string;
  hasNote: boolean;
}>;

export type TemplateContractRow = Readonly<{
  row_number: number;
  structuralTimeA: string | null;
  rowHeight: number | null;
  hidden: boolean;
  mergedRangeMembership: readonly Readonly<{
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  }>[];
  columns: readonly TemplateContractColumn[];
  structuralFingerprint: string;
  formulaColumns: readonly StructureAuditCol[];
}>;

export function buildTemplateContractRow(input: {
  row: RedactedRowAudit;
  merges?: readonly Readonly<{
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  }>[];
}): TemplateContractRow {
  const row = input.row;
  const merges = (input.merges ?? []).filter(
    (m) =>
      m.startRowIndex <= row.row_number - 1 && m.endRowIndex > row.row_number - 1,
  );
  const columns: TemplateContractColumn[] = row.cells.map((c) => ({
    column: c.col,
    hasValue: !c.isBlank,
    valueType: c.valueType,
    hasFormula: c.hasFormula,
    hasValidation: c.hasValidation,
    validationFingerprint: c.validationFingerprint,
    userFormatFingerprint: c.userFormatFingerprint,
    effectiveFormatFingerprint: c.effectiveFormatFingerprint,
    hasNote: c.hasNote,
  }));
  // Fingerprint estructural: formato + validación + presencia de fórmula (NO values).
  const structuralFingerprint = fingerprint(
    columns.map((c) => ({
      col: c.column,
      uf: c.userFormatFingerprint,
      ef: c.effectiveFormatFingerprint,
      v: c.validationFingerprint,
      hasV: c.hasValidation,
      hasF: c.hasFormula,
    })),
  );
  return {
    row_number: row.row_number,
    structuralTimeA: row.cells[0]?.structuralTextA ?? null,
    rowHeight: row.pixelSize,
    hidden: row.hidden,
    mergedRangeMembership: merges,
    columns,
    structuralFingerprint,
    formulaColumns: columns.filter((c) => c.hasFormula).map((c) => c.column),
  };
}

export type FormulaClass = "STRUCTURAL_REQUIRED" | "HISTORICAL_OR_BOOKING_SPECIFIC" | "NONE";

/** Default: fórmulas en filas Firmas se tratan como históricas; nuevas filas sin fórmulas. */
export function classifyFirmasFormula(
  col: StructureAuditCol,
  _hasFormula: boolean,
): FormulaClass {
  if (!_hasFormula) return "NONE";
  // A nunca debe ser fórmula para hora target; E:N/O:U con fórmula → histórico.
  if (col === "A") return "HISTORICAL_OR_BOOKING_SPECIFIC";
  return "HISTORICAL_OR_BOOKING_SPECIFIC";
}

export type PerHourFormatSource = Readonly<{
  targetHour: string;
  sourceHourPreferred: string;
  sourceRow: number | null;
  structuralFingerprint: string | null;
  rowHeight: number | null;
  formulaColumns: readonly StructureAuditCol[];
  validationColumns: readonly StructureAuditCol[];
  occupiedSourceAllowed: true;
  reason: string;
}>;

/**
 * P212 Fase 1.8: source-format por target hour.
 * MTY 08←08:30, 09←09:00, 10←10:00. APO ←10:30 (o 10:00).
 * Filas OCUPADAS OK — solo formato/validación/altura.
 */
export function pickPerHourFormatSources(input: {
  sede: "monterrey" | "apodaca";
  rows: readonly RedactedRowAudit[];
  parseTime: (raw: string) => string | null;
  merges?: readonly Readonly<{
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  }>[];
}): ReadonlyArray<PerHourFormatSource> {
  const byHour = new Map<string, RedactedRowAudit[]>();
  for (const r of input.rows) {
    if (!isFormatSourceFirmasRow(r)) continue;
    const t = input.parseTime(r.cells[0]?.structuralTextA ?? "");
    if (!t) continue;
    const list = byHour.get(t) ?? [];
    list.push(r);
    byHour.set(t, list);
  }

  const mapping: ReadonlyArray<{ target: string; preferred: readonly string[] }> =
    input.sede === "monterrey"
      ? [
          { target: "08:00", preferred: ["08:30", "08:00"] },
          { target: "09:00", preferred: ["09:00", "09:30"] },
          { target: "10:00", preferred: ["10:00", "10:30"] },
        ]
      : [
          { target: "08:00", preferred: ["10:30", "10:00", "08:00"] },
          { target: "09:00", preferred: ["10:30", "10:00", "09:00"] },
          { target: "10:00", preferred: ["10:30", "10:00"] },
        ];

  return mapping.map(({ target, preferred }) => {
    let chosen: RedactedRowAudit | null = null;
    let sourceHour = preferred[0]!;
    for (const h of preferred) {
      const list = byHour.get(h) ?? [];
      // Preferir fuente blank (solo formato) sobre ocupada; ambas permitidas.
      const ranked = [...list].sort((a, b) => {
        const score = (r: RedactedRowAudit) =>
          (r.bdOccupied ? 1 : 0) +
          (r.enHasHumanResult ? 1 : 0) +
          (r.ouHasBookingMeta ? 1 : 0);
        return score(a) - score(b);
      });
      if (ranked[0]) {
        chosen = ranked[0]!;
        sourceHour = h;
        break;
      }
    }
    if (!chosen) {
      // Cualquier fila Firmas de la sede como fallback de formato.
      for (const list of byHour.values()) {
        if (list[0]) {
          chosen = list[0]!;
          sourceHour = input.parseTime(chosen.cells[0]?.structuralTextA ?? "") ?? sourceHour;
          break;
        }
      }
    }
    if (!chosen) {
      return {
        targetHour: target,
        sourceHourPreferred: preferred[0]!,
        sourceRow: null,
        structuralFingerprint: null,
        rowHeight: null,
        formulaColumns: [],
        validationColumns: [],
        occupiedSourceAllowed: true as const,
        reason: "STOP_FORMAT_SOURCE_MISSING",
      };
    }
    const contract = buildTemplateContractRow({ row: chosen, merges: input.merges });
    return {
      targetHour: target,
      sourceHourPreferred: sourceHour,
      sourceRow: chosen.row_number,
      structuralFingerprint: contract.structuralFingerprint,
      rowHeight: contract.rowHeight,
      formulaColumns: contract.formulaColumns,
      validationColumns: contract.columns
        .filter((c) => c.hasValidation)
        .map((c) => c.column),
      occupiedSourceAllowed: true as const,
      reason: "format_source_ok",
    };
  });
}

/** Consistencia estructural entre filas del mismo horario (ignora values). */
export function structuralConsistencyAmongHours(
  contracts: readonly TemplateContractRow[],
): { consistent: boolean; uniqueFingerprints: number } {
  const fps = [...new Set(contracts.map((c) => c.structuralFingerprint))];
  return { consistent: fps.length <= 1, uniqueFingerprints: fps.length };
}

export function pickFirmasSourceTemplate(input: {
  sede: "monterrey" | "apodaca";
  rows: readonly RedactedRowAudit[];
  parseTime: (raw: string) => string | null;
  targetHours?: readonly string[];
}): FirmasTemplatePick {
  const targets = input.targetHours ?? ["08:00", "09:00", "10:00", "08:30", "09:30", "10:30"];
  const candidates = input.rows.filter(isReusableFirmasTemplateRow);
  const byHour = new Map<string, RedactedRowAudit[]>();
  for (const r of candidates) {
    const t = input.parseTime(r.cells[0]?.structuralTextA ?? "");
    if (!t) continue;
    const list = byHour.get(t) ?? [];
    list.push(r);
    byHour.set(t, list);
  }
  const compared = targets.filter((h) => (byHour.get(h) ?? []).length > 0);
  if (candidates.length === 0) {
    return {
      sede: input.sede,
      sourceTemplateRow: null,
      candidateRows: [],
      sameTemplateAcrossTargetHours: null,
      hoursCompared: compared,
      reason: "STOP_TEMPLATE_MISSING: no hay fila disponible B:D/E:N/O:U vacíos con hora A",
    };
  }
  // Preferir una fila target 08/09/10 si existe; si no, cualquier candidata.
  const preferredHours = ["08:00", "09:00", "10:00", "08:30", "09:30", "10:30"];
  let chosen: RedactedRowAudit | null = null;
  for (const h of preferredHours) {
    const list = byHour.get(h);
    if (list?.[0]) {
      chosen = list[0]!;
      break;
    }
  }
  if (!chosen) chosen = candidates[0]!;

  const fps = compared.map((h) => {
    const r = byHour.get(h)?.[0];
    return r
      ? `${r.rowFormatFingerprint}|${r.rowValidationFingerprint}`
      : null;
  });
  const present = fps.filter((x): x is string => Boolean(x));
  const same =
    present.length <= 1 ? true : present.every((x) => x === present[0]);

  return {
    sede: input.sede,
    sourceTemplateRow: chosen.row_number,
    candidateRows: candidates.map((c) => c.row_number),
    sameTemplateAcrossTargetHours: same,
    hoursCompared: compared,
    reason: same
      ? "template_consistent"
      : "STOP_TEMPLATE_INCONSISTENT: fingerprints difieren entre horas",
  };
}

/**
 * Fase 1.7 (legacy): exigía blank template + same fingerprint across hours + header APO.
 * Conservado para modo `firmas_template_audit` histórico.
 */
export function classifyTabTemplateDecision(input: {
  mty: FirmasTemplatePick;
  apo: FirmasTemplatePick;
  headerMty: boolean;
  headerApo: boolean;
}): "SAFE_APPEND_ONLY" | "STOP_TEMPLATE_INCONSISTENT" | "STOP_TEMPLATE_MISSING" {
  if (!input.headerMty || !input.headerApo) return "STOP_TEMPLATE_MISSING";
  if (!input.mty.sourceTemplateRow || !input.apo.sourceTemplateRow) {
    return "STOP_TEMPLATE_MISSING";
  }
  if (
    input.mty.sameTemplateAcrossTargetHours === false ||
    input.apo.sameTemplateAcrossTargetHours === false
  ) {
    return "STOP_TEMPLATE_INCONSISTENT";
  }
  return "SAFE_APPEND_ONLY";
}

/**
 * Fase 1.8: SAFE si cada target MTY/APO tiene source-format estructural
 * (fila ocupada OK). Header APO legacy NO requerido (se creará canónico).
 * sameTemplateAcrossTargetHours NO es gate.
 */
export function classifyCanonicalTemplateDecision(input: {
  headerMtyKnown: boolean;
  mtyPerHour: readonly PerHourFormatSource[];
  apoPerHour: readonly PerHourFormatSource[];
  formulasRequireStructuralCopy: boolean;
}): "SAFE_CANONICAL_APPEND" | "STOP_TEMPLATE_MISSING" | "STOP_FORMULA_GATE" {
  if (input.formulasRequireStructuralCopy) return "STOP_FORMULA_GATE";
  if (!input.headerMtyKnown) return "STOP_TEMPLATE_MISSING";
  const mtyOk = input.mtyPerHour.every((p) => p.sourceRow != null);
  const apoOk = input.apoPerHour.every((p) => p.sourceRow != null);
  if (!mtyOk || !apoOk) return "STOP_TEMPLATE_MISSING";
  return "SAFE_CANONICAL_APPEND";
}

/** Contrato A:U objetivo (sin inventar valores técnicos). */
export function buildTargetAuContract(input: {
  sede: "monterrey" | "apodaca";
  targetHour: string;
  sourceTemplateRow: number | null;
  templateRow: RedactedRowAudit | null;
}): Readonly<{
  sede: string;
  targetHour: string;
  sourceTemplateRow: number | null;
  A: { role: "hora_target"; copyStructuralFromTemplate: boolean };
  BD: { role: "blank_initial"; preserveFormatFromTemplate: boolean };
  EN: {
    role: "preserve_structure_no_human_result";
    hasValidation: boolean;
    hasFormula: boolean;
    formatFingerprint: string | null;
  };
  OU: {
    role: "blank_initial_worker_fills_on_booking";
    preserveFormatFromTemplate: boolean;
    inventedTechValues: false;
  };
}> {
  const cells = input.templateRow?.cells ?? [];
  const en = cells.slice(4, 14);
  return {
    sede: input.sede,
    targetHour: input.targetHour,
    sourceTemplateRow: input.sourceTemplateRow,
    A: { role: "hora_target", copyStructuralFromTemplate: false },
    BD: { role: "blank_initial", preserveFormatFromTemplate: true },
    EN: {
      role: "preserve_structure_no_human_result",
      hasValidation: en.some((c) => c.hasValidation),
      hasFormula: en.some((c) => c.hasFormula),
      formatFingerprint: input.templateRow?.rowFormatFingerprint ?? null,
    },
    OU: {
      role: "blank_initial_worker_fills_on_booking",
      preserveFormatFromTemplate: true,
      inventedTechValues: false,
    },
  };
}
