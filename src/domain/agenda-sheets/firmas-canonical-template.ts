/**
 * P212 Fase 1.8 — FirmasCanonicalTemplate (código controla plantilla; no blank legacy).
 * Append futuro: PASTE_FORMAT + PASTE_DATA_VALIDATION; A=hora; B:U blank values.
 */

export type FirmasCanonicalHeader = Readonly<{
  text: "MONTERREY FIRMAS" | "APODACA FIRMAS";
  mergeSpan: number; // A:G = 7
  rowHeight: number; // observado 21
  formatFingerprint: string | null;
  styleSource: "MONTERREY FIRMAS";
  copyValues: false;
  copyNotes: false;
}>;

export type FirmasCanonicalColumnFormat = Readonly<{
  column: string;
  userFormatFingerprint: string | null;
  effectiveFormatFingerprint: string | null;
  validationFingerprint: string | null;
  hasValidation: boolean;
}>;

export type FirmasCanonicalRow = Readonly<{
  rowHeight: number | null;
  columnFormats: readonly FirmasCanonicalColumnFormat[];
  validations: readonly string[];
  formulasInNewRows: false;
  notesInNewRows: false;
  pasteNormal: "FORBIDDEN";
  pasteFormat: "ALLOWED";
  pasteDataValidation: "ALLOWED_IF_NEEDED";
}>;

export type FirmasCanonicalTemplate = Readonly<{
  id: "monterrey08" | "monterrey09" | "monterrey10" | "apodaca";
  sede: "monterrey" | "apodaca";
  targetHour: "08:00" | "09:00" | "10:00";
  sourceFormatHour: string;
  sourceFormatRowHint: number | null;
  structuralFingerprint: string | null;
  header: FirmasCanonicalHeader;
  row: FirmasCanonicalRow;
}>;

export const FIRMAS_CANONICAL_HEADER_MTY: FirmasCanonicalHeader = {
  text: "MONTERREY FIRMAS",
  mergeSpan: 7,
  rowHeight: 21,
  formatFingerprint: null,
  styleSource: "MONTERREY FIRMAS",
  copyValues: false,
  copyNotes: false,
};

export const FIRMAS_CANONICAL_HEADER_APO: FirmasCanonicalHeader = {
  text: "APODACA FIRMAS",
  mergeSpan: 7,
  rowHeight: 21,
  formatFingerprint: null,
  styleSource: "MONTERREY FIRMAS",
  copyValues: false,
  copyNotes: false,
};

export function buildFirmasCanonicalTemplates(input: {
  headerFormatFingerprint?: string | null;
  mty: {
    "08:00": { sourceRow: number | null; sourceHour: string; fp: string | null; rowHeight: number | null; validations: readonly string[] };
    "09:00": { sourceRow: number | null; sourceHour: string; fp: string | null; rowHeight: number | null; validations: readonly string[] };
    "10:00": { sourceRow: number | null; sourceHour: string; fp: string | null; rowHeight: number | null; validations: readonly string[] };
  };
  apo: {
    sourceRow: number | null;
    sourceHour: string;
    fp: string | null;
    rowHeight: number | null;
    validations: readonly string[];
  };
}): {
  monterrey08: FirmasCanonicalTemplate;
  monterrey09: FirmasCanonicalTemplate;
  monterrey10: FirmasCanonicalTemplate;
  apodaca: FirmasCanonicalTemplate;
  allKnown: boolean;
} {
  const hdrFp = input.headerFormatFingerprint ?? null;
  const headerMty: FirmasCanonicalHeader = {
    ...FIRMAS_CANONICAL_HEADER_MTY,
    formatFingerprint: hdrFp,
  };
  const headerApo: FirmasCanonicalHeader = {
    ...FIRMAS_CANONICAL_HEADER_APO,
    formatFingerprint: hdrFp,
  };

  const mkRow = (v: {
    rowHeight: number | null;
    validations: readonly string[];
  }): FirmasCanonicalRow => ({
    rowHeight: v.rowHeight,
    columnFormats: [],
    validations: v.validations,
    formulasInNewRows: false,
    notesInNewRows: false,
    pasteNormal: "FORBIDDEN",
    pasteFormat: "ALLOWED",
    pasteDataValidation: "ALLOWED_IF_NEEDED",
  });

  const monterrey08: FirmasCanonicalTemplate = {
    id: "monterrey08",
    sede: "monterrey",
    targetHour: "08:00",
    sourceFormatHour: input.mty["08:00"].sourceHour,
    sourceFormatRowHint: input.mty["08:00"].sourceRow,
    structuralFingerprint: input.mty["08:00"].fp,
    header: headerMty,
    row: mkRow(input.mty["08:00"]),
  };
  const monterrey09: FirmasCanonicalTemplate = {
    id: "monterrey09",
    sede: "monterrey",
    targetHour: "09:00",
    sourceFormatHour: input.mty["09:00"].sourceHour,
    sourceFormatRowHint: input.mty["09:00"].sourceRow,
    structuralFingerprint: input.mty["09:00"].fp,
    header: headerMty,
    row: mkRow(input.mty["09:00"]),
  };
  const monterrey10: FirmasCanonicalTemplate = {
    id: "monterrey10",
    sede: "monterrey",
    targetHour: "10:00",
    sourceFormatHour: input.mty["10:00"].sourceHour,
    sourceFormatRowHint: input.mty["10:00"].sourceRow,
    structuralFingerprint: input.mty["10:00"].fp,
    header: headerMty,
    row: mkRow(input.mty["10:00"]),
  };
  const apodaca: FirmasCanonicalTemplate = {
    id: "apodaca",
    sede: "apodaca",
    targetHour: "10:00",
    sourceFormatHour: input.apo.sourceHour,
    sourceFormatRowHint: input.apo.sourceRow,
    structuralFingerprint: input.apo.fp,
    header: headerApo,
    row: mkRow(input.apo),
  };

  const allKnown = Boolean(
    monterrey08.sourceFormatRowHint &&
      monterrey09.sourceFormatRowHint &&
      monterrey10.sourceFormatRowHint &&
      apodaca.sourceFormatRowHint &&
      headerMty.mergeSpan === 7,
  );

  return { monterrey08, monterrey09, monterrey10, apodaca, allKnown };
}

/** Criterio Fase 1.8 para superar STOP_TEMPLATE. */
export function evaluateCanonicalTemplateGate(input: {
  headerCanonicalKnown: boolean;
  mty08Known: boolean;
  mty09Known: boolean;
  mty10Known: boolean;
  apoCanonicalKnown: boolean;
  formulasStructuralRequired: boolean;
}): "READY_FOR_CONTROLLED_APPEND_APPLY" | "STOP" {
  if (input.formulasStructuralRequired) return "STOP";
  if (
    input.headerCanonicalKnown &&
    input.mty08Known &&
    input.mty09Known &&
    input.mty10Known &&
    input.apoCanonicalKnown
  ) {
    return "READY_FOR_CONTROLLED_APPEND_APPLY";
  }
  return "STOP";
}

/**
 * Diseño provisioner futuro: NO busca blank legacy; usa FirmasCanonicalTemplate.
 */
export function firmasProvisionerProcessSteps(): readonly string[] {
  return [
    "1.read_tab",
    "2.compute_deficit",
    "3.append_header_and_missing_rows",
    "4.apply_canonical_format_validation",
    "5.write_hours_column_A_only",
    "6.readback",
    "7.inventory_refresh",
    "8.verify",
  ] as const;
}

export type GeneratedAppendedBlock = Readonly<{
  lines: readonly string[];
  mtyAdds: Record<"08:00" | "09:00" | "10:00", number>;
  apoAdds: Record<"08:00" | "09:00" | "10:00", number>;
}>;

/** Simula bloque append canónico (solo labels/horas; sin values B:U). */
export function generateCanonicalAppendedBlock(input: {
  mtyAdd: Record<"08:00" | "09:00" | "10:00", number>;
  apoAdd: Record<"08:00" | "09:00" | "10:00", number>;
}): GeneratedAppendedBlock {
  const lines: string[] = [];
  const hours = ["08:00", "09:00", "10:00"] as const;
  const mtyTotal = hours.reduce((s, h) => s + input.mtyAdd[h], 0);
  const apoTotal = hours.reduce((s, h) => s + input.apoAdd[h], 0);
  if (mtyTotal > 0) {
    lines.push("MONTERREY FIRMAS");
    for (const h of hours) {
      for (let i = 0; i < input.mtyAdd[h]; i++) lines.push(h);
    }
  }
  if (apoTotal > 0) {
    lines.push("APODACA FIRMAS");
    for (const h of hours) {
      for (let i = 0; i < input.apoAdd[h]; i++) lines.push(h);
    }
  }
  return { lines, mtyAdds: input.mtyAdd, apoAdds: input.apoAdd };
}
