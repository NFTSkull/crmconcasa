/**
 * Edge Function AISLADA: agenda-sheet-structure-audit v2
 * Único propósito: inspección READ-ONLY de estructura Google Sheets (Firmas A:U).
 * NO forma parte del flujo productivo (live-sync / worker / reconcile / webhook).
 *
 * Auth: x-concasa-worker-secret (GOOGLE_SHEETS_WORKER_SECRET), timing-safe.
 * Google: solo GET (spreadsheets.readonly + values.batchGet).
 * Nunca loguea private key / service role / worker secret / JWT / OAuth token.
 *
 * Modes:
 * - template_contract (default, Fase 1.8): format sources per hour; occupied OK.
 * - firmas_template_audit (legacy 1.7): blank-template + same-fingerprint gate.
 */
import {
  DEFAULT_SPREADSHEET_ID,
  jsonError,
  jsonOk,
  parseSection,
  parseTabDate,
  parseTime,
  timingSafeEqual,
} from "../_shared/agenda-sheets/parsers.ts";
import { createReadOnlyStructureSheetsAdapter } from "../_shared/agenda-sheets/google-readonly-structure.ts";
import {
  isPlausibleFirmasApodacaTime,
  resolveOrphanSection,
  type SheetSectionRef,
} from "../_shared/agenda-sheets/section-recovery.ts";
import {
  buildTargetAuContract,
  buildTemplateContractRow,
  classifyCanonicalTemplateDecision,
  classifyFirmasFormula,
  classifyTabTemplateDecision,
  pickFirmasSourceTemplate,
  pickPerHourFormatSources,
  redactRow,
  type HeaderAudit,
  type RedactedRowAudit,
  type TemplateContractRow,
} from "../_shared/agenda-sheets/structure-audit.ts";

type SheetGridPayload = {
  properties?: {
    sheetId?: number;
    title?: string;
    hidden?: boolean;
    gridProperties?: { rowCount?: number; columnCount?: number };
  };
  merges?: Array<{
    startRowIndex?: number;
    endRowIndex?: number;
    startColumnIndex?: number;
    endColumnIndex?: number;
  }>;
  data?: Array<{
    startRow?: number;
    rowMetadata?: Array<{
      pixelSize?: number;
      hiddenByUser?: boolean;
      hiddenByFilter?: boolean;
    }>;
    rowData?: Array<{
      values?: Array<{
        userEnteredValue?: Record<string, unknown>;
        effectiveValue?: Record<string, unknown>;
        userEnteredFormat?: Record<string, unknown>;
        effectiveFormat?: Record<string, unknown>;
        dataValidation?: Record<string, unknown>;
        note?: string;
      }>;
    }>;
  }>;
};

function quoteSheetTitle(title: string): string {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function yearHint(): number {
  const y = Number(Deno.env.get("AGENDA_SHEETS_YEAR") ?? "2026");
  return Number.isFinite(y) && y >= 2020 ? y : 2026;
}

type Merge = Readonly<{
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
}>;

function collectFirmasRowsWithOrphans(input: {
  rows: readonly RedactedRowAudit[];
}): {
  mtyRows: RedactedRowAudit[];
  apoRows: RedactedRowAudit[];
  headerMty: HeaderAudit | null;
  headerApo: HeaderAudit | null;
  merges: Merge[];
  setMerges: (m: Merge[]) => void;
} {
  // Placeholder — real impl below uses merges from caller.
  void input;
  return {
    mtyRows: [],
    apoRows: [],
    headerMty: null,
    headerApo: null,
    merges: [],
    setMerges: () => {},
  };
}
void collectFirmasRowsWithOrphans;

function partitionFirmasRows(input: {
  rows: readonly RedactedRowAudit[];
  merges: readonly Merge[];
}): {
  mtyRows: RedactedRowAudit[];
  apoRows: RedactedRowAudit[];
  headerMty: HeaderAudit | null;
  headerApo: HeaderAudit | null;
} {
  const { rows, merges } = input;
  type Sec = {
    sede: "monterrey" | "apodaca";
    headerRow: number;
    endExclusive: number;
  };
  const sections: Sec[] = [];
  for (const r of rows) {
    const a = r.cells[0]?.structuralTextA ?? "";
    const sec = parseSection(a);
    if (sec?.kind === "firmas" && (sec.sede === "monterrey" || sec.sede === "apodaca")) {
      sections.push({
        sede: sec.sede,
        headerRow: r.row_number,
        endExclusive: rows[rows.length - 1]!.row_number + 1,
      });
    } else if (sec && sections.length > 0) {
      const prev = sections[sections.length - 1]!;
      if (prev.endExclusive > r.row_number) prev.endExclusive = r.row_number;
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    const cur = sections[i]!;
    const next = sections[i + 1]!;
    if (cur.endExclusive > next.headerRow) cur.endExclusive = next.headerRow;
  }

  function headerAudit(sede: "monterrey" | "apodaca"): HeaderAudit | null {
    const sec = sections.find((s) => s.sede === sede);
    if (!sec) return null;
    const row = rows.find((r) => r.row_number === sec.headerRow);
    if (!row) return null;
    const relatedMerges = merges.filter(
      (m) =>
        m.startRowIndex <= sec.headerRow - 1 && m.endRowIndex > sec.headerRow - 1,
    );
    const span =
      relatedMerges.length > 0
        ? Math.max(
            ...relatedMerges.map((m) => m.endColumnIndex - m.startColumnIndex),
          )
        : null;
    return {
      row_number: row.row_number,
      titleStructural: row.cells[0]?.structuralTextA ?? "",
      sede,
      pixelSize: row.pixelSize,
      mergeRanges: relatedMerges,
      columnSpanHint: span,
      formatFingerprint: row.rowFormatFingerprint,
      hasValidation: row.cells.some((c) => c.hasValidation),
      cells: row.cells,
    };
  }

  function rowsForSede(sede: "monterrey" | "apodaca"): RedactedRowAudit[] {
    const sec = sections.find((s) => s.sede === sede);
    if (!sec) return [];
    return rows.filter(
      (r) => r.row_number > sec.headerRow && r.row_number < sec.endExclusive,
    );
  }

  const mtyRows = rowsForSede("monterrey");
  const apoRows = rowsForSede("apodaca");
  const headerMty = headerAudit("monterrey");
  const headerApo = headerAudit("apodaca");

  // Orphan recovery: filas-hora sin header APODACA FIRMAS (legacy).
  if (apoRows.length === 0) {
    const columnA = rows.map((r) => r.cells[0]?.structuralTextA ?? "");
    const orphanBuf: { row: RedactedRowAudit; time: string }[] = [];
    let prevSec: SheetSectionRef | null = null;
    const flush = (nextSec: SheetSectionRef | null) => {
      if (orphanBuf.length === 0) return;
      const resolved = resolveOrphanSection({
        orphanTimes: orphanBuf.map((o) => o.time),
        orphanSheetRows: orphanBuf.map((o) => o.row.row_number),
        nextSection: nextSec,
        prevSection: prevSec,
      });
      if (resolved?.sede === "apodaca" && resolved.kind === "firmas") {
        for (const o of orphanBuf) apoRows.push(o.row);
      } else if (resolved?.sede === "monterrey" && resolved.kind === "firmas") {
        for (const o of orphanBuf) mtyRows.push(o.row);
      }
      orphanBuf.length = 0;
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const a = r.cells[0]?.structuralTextA ?? "";
      const sec = parseSection(a);
      if (sec) {
        flush(
          sec.sede === "monterrey" || sec.sede === "apodaca"
            ? { sede: sec.sede, kind: sec.kind as SheetSectionRef["kind"] }
            : null,
        );
        if (sec.kind === "firmas" || sec.kind === "biometricos" || sec.kind === "inscripcion") {
          if (sec.sede === "monterrey" || sec.sede === "apodaca") {
            prevSec = {
              sede: sec.sede,
              kind: sec.kind as SheetSectionRef["kind"],
            };
          }
        }
        continue;
      }
      const t = parseTime(a);
      if (!t) continue;
      // Solo considerar candidatos APO (10:00/10:30/targets) fuera de secciones sticky.
      if (!isPlausibleFirmasApodacaTime(t) && t !== "08:00" && t !== "09:00") {
        continue;
      }
      // Si ya hay sección MTY activa sticky via parse — skip rows already in mtyRows.
      if (mtyRows.some((x) => x.row_number === r.row_number)) continue;
      if (apoRows.some((x) => x.row_number === r.row_number)) continue;
      orphanBuf.push({ row: r, time: t });
      // Peek next header to resolve promptly when buffer grows.
      const nextHdr = (() => {
        for (let j = i + 1; j < columnA.length; j++) {
          const s = parseSection(columnA[j] ?? "");
          if (s && (s.sede === "monterrey" || s.sede === "apodaca")) {
            return {
              sede: s.sede as "monterrey" | "apodaca",
              kind: s.kind as SheetSectionRef["kind"],
            };
          }
        }
        return null;
      })();
      // Flush when next header is imminent (next row is header) or end.
      const nextA = rows[i + 1]?.cells[0]?.structuralTextA ?? "";
      if (parseSection(nextA) || i === rows.length - 1) {
        flush(nextHdr);
      }
    }
    flush(null);
  }

  return { mtyRows, apoRows, headerMty, headerApo };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
    }

    const secret =
      (Deno.env.get("GOOGLE_SHEETS_WORKER_SECRET") ?? "").trim() ||
      (Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "").trim();
    const hdr =
      req.headers.get("x-concasa-worker-secret") ??
      req.headers.get("x-concasa-webhook-secret") ??
      "";
    if (!secret || !timingSafeEqual(hdr, secret)) {
      return jsonError(401, "unauthorized", "Secreto inválido");
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const mode =
      body.mode === "firmas_template_audit" ? "firmas_template_audit" : "template_contract";

    const email = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "").trim();
    const pk = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").trim();
    const spreadsheetId =
      (Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? "").trim() ||
      DEFAULT_SPREADSHEET_ID;

    if (!email || !pk) {
      return jsonError(500, "missing_google_creds", "Credenciales no configuradas");
    }

    const fromYmd = String(body.from ?? "2026-09-01").slice(0, 10);
    const toYmd = String(body.to ?? "2026-09-30").slice(0, 10);
    const titleFilter = Array.isArray(body.tabs)
      ? new Set(body.tabs.map((t) => String(t)))
      : null;
    const maxTabs = Math.min(
      40,
      Math.max(1, Number(body.max_tabs ?? 22) || 22),
    );

    const adapter = await createReadOnlyStructureSheetsAdapter({
      spreadsheetId,
      serviceAccountEmail: email,
      privateKeyPem: pk,
    });

    const sheets = await adapter.listSheets();
    const y = yearHint();
    const targets = sheets
      .filter((s) => !s.hidden)
      .map((s) => {
        const d = parseTabDate(s.title, y);
        return { ...s, bookingDate: d };
      })
      .filter((s) => {
        if (!s.bookingDate) return false;
        if (s.bookingDate < fromYmd || s.bookingDate > toYmd) return false;
        if (titleFilter && !titleFilter.has(s.title)) return false;
        return true;
      })
      .sort((a, b) => String(a.bookingDate).localeCompare(String(b.bookingDate)))
      .slice(0, maxTabs);

    const tabReports: unknown[] = [];
    let safe = 0;
    let stopMissing = 0;
    let stopInconsistent = 0;
    let stopFormula = 0;

    for (const tab of targets) {
      const range = `${quoteSheetTitle(tab.title)}!A1:U200`;
      const raw = (await adapter.getSpreadsheetStructure({
        rangesA1: [range],
        includeGridData: true,
      })) as { sheets?: SheetGridPayload[] };

      const sheetPayload =
        (raw.sheets ?? []).find(
          (s) => Number(s.properties?.sheetId) === tab.sheetId,
        ) ??
        (raw.sheets ?? [])[0] ??
        null;

      const dataBlock = sheetPayload?.data?.[0];
      const startRow = Number(dataBlock?.startRow ?? 0);
      const rowData = dataBlock?.rowData ?? [];
      const rowMeta = dataBlock?.rowMetadata ?? [];
      const merges: Merge[] = (sheetPayload?.merges ?? []).map((m) => ({
        startRowIndex: Number(m.startRowIndex ?? 0),
        endRowIndex: Number(m.endRowIndex ?? 0),
        startColumnIndex: Number(m.startColumnIndex ?? 0),
        endColumnIndex: Number(m.endColumnIndex ?? 0),
      }));

      const rows: RedactedRowAudit[] = [];
      for (let i = 0; i < rowData.length; i++) {
        const absRow = startRow + i + 1;
        const meta = rowMeta[i];
        rows.push(
          redactRow({
            row_number: absRow,
            pixelSize: meta?.pixelSize ?? null,
            hidden: Boolean(meta?.hiddenByUser || meta?.hiddenByFilter),
            values: rowData[i]?.values ?? [],
          }),
        );
      }

      const { mtyRows, apoRows, headerMty, headerApo } = partitionFirmasRows({
        rows,
        merges,
      });

      if (mode === "firmas_template_audit") {
        const mtyPick = pickFirmasSourceTemplate({
          sede: "monterrey",
          rows: mtyRows,
          parseTime,
        });
        const apoPick = pickFirmasSourceTemplate({
          sede: "apodaca",
          rows: apoRows,
          parseTime,
        });
        const decision = classifyTabTemplateDecision({
          mty: mtyPick,
          apo: apoPick,
          headerMty: Boolean(headerMty),
          headerApo: Boolean(headerApo),
        });
        if (decision === "SAFE_APPEND_ONLY") safe += 1;
        else if (decision === "STOP_TEMPLATE_MISSING") stopMissing += 1;
        else stopInconsistent += 1;

        const mtyTemplate =
          mtyRows.find((r) => r.row_number === mtyPick.sourceTemplateRow) ?? null;
        const apoTemplate =
          apoRows.find((r) => r.row_number === apoPick.sourceTemplateRow) ?? null;

        tabReports.push({
          sheetId: tab.sheetId,
          title: tab.title,
          bookingDate: tab.bookingDate,
          gridRowCount: tab.rowCount,
          decision,
          headers: { monterrey: headerMty, apodaca: headerApo },
          templates: { monterrey: mtyPick, apodaca: apoPick },
          targetAuContract: {
            monterrey: buildTargetAuContract({
              sede: "monterrey",
              targetHour: "09:00",
              sourceTemplateRow: mtyPick.sourceTemplateRow,
              templateRow: mtyTemplate,
            }),
            apodaca: buildTargetAuContract({
              sede: "apodaca",
              targetHour: "10:30",
              sourceTemplateRow: apoPick.sourceTemplateRow,
              templateRow: apoTemplate,
            }),
          },
          sheetWrites: 0,
        });
        continue;
      }

      // ——— mode: template_contract (Fase 1.8) ———
      const mtyPerHour = pickPerHourFormatSources({
        sede: "monterrey",
        rows: mtyRows,
        parseTime,
        merges,
      });
      const apoPerHour = pickPerHourFormatSources({
        sede: "apodaca",
        rows: apoRows,
        parseTime,
        merges,
      });

      const sourceContracts: TemplateContractRow[] = [];
      const formulaFindings: Array<{
        sede: string;
        row: number;
        column: string;
        classification: string;
      }> = [];

      for (const [sede, list] of [
        ["monterrey", mtyRows] as const,
        ["apodaca", apoRows] as const,
      ]) {
        for (const r of list) {
          const contract = buildTemplateContractRow({ row: r, merges });
          for (const col of contract.formulaColumns) {
            const cls = classifyFirmasFormula(col, true);
            formulaFindings.push({
              sede,
              row: r.row_number,
              column: col,
              classification: cls,
            });
          }
        }
      }

      for (const p of [...mtyPerHour, ...apoPerHour]) {
        if (p.sourceRow == null) continue;
        const src =
          mtyRows.find((r) => r.row_number === p.sourceRow) ??
          apoRows.find((r) => r.row_number === p.sourceRow);
        if (src) sourceContracts.push(buildTemplateContractRow({ row: src, merges }));
      }

      // Hard gate: ninguna fórmula clasificada STRUCTURAL_REQUIRED (default histórico).
      const formulasRequireStructuralCopy = formulaFindings.some(
        (f) => f.classification === "STRUCTURAL_REQUIRED",
      );

      const decision = classifyCanonicalTemplateDecision({
        headerMtyKnown: Boolean(headerMty),
        mtyPerHour,
        apoPerHour,
        formulasRequireStructuralCopy,
      });
      if (decision === "SAFE_CANONICAL_APPEND") safe += 1;
      else if (decision === "STOP_FORMULA_GATE") stopFormula += 1;
      else stopMissing += 1;

      const apo1030 = apoRows.filter((r) => {
        const t = parseTime(r.cells[0]?.structuralTextA ?? "");
        return t === "10:30";
      });
      const apo1030Contracts = apo1030.map((r) =>
        buildTemplateContractRow({ row: r, merges }),
      );
      const apoFpSet = new Set(apo1030Contracts.map((c) => c.structuralFingerprint));

      const validationUnion = [
        ...new Set(
          [...mtyPerHour, ...apoPerHour].flatMap((p) => [...p.validationColumns]),
        ),
      ];

      tabReports.push({
        sheetId: tab.sheetId,
        title: tab.title,
        bookingDate: tab.bookingDate,
        gridRowCount: tab.rowCount,
        decision,
        headers: {
          monterrey: headerMty
            ? {
                row_number: headerMty.row_number,
                titleStructural: headerMty.titleStructural,
                pixelSize: headerMty.pixelSize,
                columnSpanHint: headerMty.columnSpanHint,
                mergeAtoG: headerMty.columnSpanHint === 7,
                formatFingerprint: headerMty.formatFingerprint,
                // Header APO legacy no requerido; canónico futuro usa estilo MTY.
                apoLegacyHeaderRequired: false,
                apoCanonicalHeaderText: "APODACA FIRMAS",
              }
            : null,
          apodaca: headerApo
            ? {
                row_number: headerApo.row_number,
                titleStructural: headerApo.titleStructural,
                pixelSize: headerApo.pixelSize,
                columnSpanHint: headerApo.columnSpanHint,
                formatFingerprint: headerApo.formatFingerprint,
              }
            : {
                legacyMissing: true,
                willCreateCanonical: "APODACA FIRMAS",
                styleSource: "MONTERREY FIRMAS",
              },
        },
        formatSources: {
          monterrey: mtyPerHour,
          apodaca: apoPerHour,
        },
        apodacaStructural: {
          sourceRowCount: apoRows.length,
          rows1030: apo1030.map((r) => r.row_number),
          rows1030FingerprintUnique: apoFpSet.size,
          sameFormatValidationAcross1030: apoFpSet.size <= 1,
        },
        templateContracts: sourceContracts.map((c) => ({
          row_number: c.row_number,
          structuralTimeA: c.structuralTimeA,
          rowHeight: c.rowHeight,
          hidden: c.hidden,
          mergedRangeMembership: c.mergedRangeMembership,
          structuralFingerprint: c.structuralFingerprint,
          formulaColumns: c.formulaColumns,
          // columns A:U sin contenido B:U (solo flags/fingerprints)
          columns: c.columns,
        })),
        formulas: {
          findings: formulaFindings.slice(0, 40),
          anyStructuralRequired: formulasRequireStructuralCopy,
          newRowsWillHaveFormulas: false,
        },
        validations: {
          columnsWithValidation: validationUnion,
          note: "Comparar MTY vs APO por sede; nunca mezclar Bio.",
        },
        futureApplyStrategy: {
          pasteNormalForbidden: true,
          pasteFormatAllowed: true,
          pasteValidationAllowedIfNeeded: true,
          writeOnlyColumnA: true,
          copyNotesForbidden: true,
          copyValuesBtoUForbidden: true,
        },
        targetAuContract: {
          monterrey08: buildTargetAuContract({
            sede: "monterrey",
            targetHour: "08:00",
            sourceTemplateRow: mtyPerHour.find((p) => p.targetHour === "08:00")
              ?.sourceRow ?? null,
            templateRow:
              mtyRows.find(
                (r) =>
                  r.row_number ===
                  mtyPerHour.find((p) => p.targetHour === "08:00")?.sourceRow,
              ) ?? null,
          }),
          monterrey09: buildTargetAuContract({
            sede: "monterrey",
            targetHour: "09:00",
            sourceTemplateRow: mtyPerHour.find((p) => p.targetHour === "09:00")
              ?.sourceRow ?? null,
            templateRow:
              mtyRows.find(
                (r) =>
                  r.row_number ===
                  mtyPerHour.find((p) => p.targetHour === "09:00")?.sourceRow,
              ) ?? null,
          }),
          monterrey10: buildTargetAuContract({
            sede: "monterrey",
            targetHour: "10:00",
            sourceTemplateRow: mtyPerHour.find((p) => p.targetHour === "10:00")
              ?.sourceRow ?? null,
            templateRow:
              mtyRows.find(
                (r) =>
                  r.row_number ===
                  mtyPerHour.find((p) => p.targetHour === "10:00")?.sourceRow,
              ) ?? null,
          }),
          apodaca: buildTargetAuContract({
            sede: "apodaca",
            targetHour: "10:00",
            sourceTemplateRow: apoPerHour.find((p) => p.targetHour === "10:00")
              ?.sourceRow ?? null,
            templateRow:
              apoRows.find(
                (r) =>
                  r.row_number ===
                  apoPerHour.find((p) => p.targetHour === "10:00")?.sourceRow,
              ) ?? null,
          }),
        },
        sheetWrites: 0,
      });
    }

    return jsonOk({
      function: "agenda-sheet-structure-audit",
      version: 2,
      mode,
      spreadsheetId,
      readOnly: true,
      googleScope: "spreadsheets.readonly",
      from: fromYmd,
      to: toYmd,
      tabsAudited: tabReports.length,
      summary:
        mode === "template_contract"
          ? {
              SAFE_CANONICAL_APPEND: safe,
              STOP_TEMPLATE_MISSING: stopMissing,
              STOP_FORMULA_GATE: stopFormula,
            }
          : {
              SAFE_APPEND_ONLY: safe,
              STOP_TEMPLATE_MISSING: stopMissing,
              STOP_TEMPLATE_INCONSISTENT: stopInconsistent,
            },
      tabs: tabReports,
      cloudDbWrites: 0,
      sheetWrites: 0,
      bookings: 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const safe = msg
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted-pem]");
    return jsonError(500, "structure_audit_failed", safe.slice(0, 240));
  }
});
