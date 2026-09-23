/**
 * Reporte PDF Admin — correcciones Mesa (RO, sin PII sensible).
 * Separado: modelo → render pdf-lib → descarga browser.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AsesorCorreccionDetalle, AsesorCorreccionItem } from "@/domain/expedientes/asesor-correccion-detalle";
import type { AdminMesaEnvioEvent } from "@/domain/admin-production/metrics";
import type { AdminPeriodBounds } from "@/domain/admin-production/period";
import {
  adminCorreccionAlcanceLabel,
  adminCorreccionFilterLabel,
  adminCorreccionUxBanner,
  adminCorreccionUxStateLabel,
  type AdminCorreccionAlcance,
  type AdminCorreccionFilter,
} from "@/domain/admin-production/admin-correccion-filter";
import type { AdminCorreccionEnrichedRow } from "@/domain/admin-production/admin-correccion-enrich";
import { formatAdminMesaAsesorLabel } from "@/domain/admin-production/mesa-seguimiento";

const MX_TZ = "America/Mexico_City";
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN_X = 40;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const COLOR = {
  headerBg: rgb(0.1, 0.14, 0.2),
  headerFg: rgb(1, 1, 1),
  ink: rgb(0.12, 0.14, 0.18),
  muted: rgb(0.35, 0.4, 0.48),
  cardBorder: rgb(0.78, 0.82, 0.88),
  bannerAmber: rgb(0.55, 0.35, 0.05),
  bannerGreen: rgb(0.1, 0.35, 0.22),
  accent: rgb(0.15, 0.35, 0.55),
};

export type AdminCorreccionesPdfItemModel = Readonly<{
  typeLabel: string;
  label: string;
  motivo: string;
  localStatusLabel: string;
}>;

export type AdminCorreccionesPdfEntryModel = Readonly<{
  index: number;
  clienteNombre: string;
  asesorNombre: string;
  etapaLabel: string;
  estadoLabel: string;
  banner: string | null;
  solicitadoAtLabel: string | null;
  items: readonly AdminCorreccionesPdfItemModel[];
}>;

export type AdminCorreccionesPdfReportModel = Readonly<{
  title: string;
  asesorLine: string;
  /** «Periodo seleccionado» | «Pendientes actuales» */
  alcanceLine: string;
  /**
   * Solo cuando alcance = periodo: «YYYY-MM-DD — YYYY-MM-DD».
   * Null en pendientes actuales (no engañar con un periodo).
   */
  periodoLine: string | null;
  /**
   * Solo cuando alcance = pendientes actuales: fecha/hora MX del corte.
   */
  corteLine: string | null;
  filtroLine: string;
  generadoLine: string;
  total: number;
  entries: readonly AdminCorreccionesPdfEntryModel[];
}>;

/** Etiquetas local_status para PDF (incluye «Documento reemplazado»). */
export function adminCorreccionPdfLocalStatusLabel(
  status: AsesorCorreccionItem["local_status"],
): string {
  switch (status) {
    case "corregido_guardado":
      return "Corregido / guardado";
    case "reemplazado":
      return "Documento reemplazado";
    default:
      return "Pendiente";
  }
}

export function adminCorreccionItemTypeLabel(
  type: AsesorCorreccionItem["type"],
): string {
  switch (type) {
    case "datos_generales":
      return "Datos generales";
    case "documento":
      return "Documento";
    case "retencion":
      return "Retención";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function formatAdminCorreccionesPdfDateTimeMx(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: MX_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatAdminCorreccionesPdfTodayYmd(nowMs = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MX_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

export function sanitizeAdminCorreccionesPdfFilenamePart(raw: string): string {
  const cleaned = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return cleaned || "ASESOR";
}

export function buildAdminCorreccionesPdfFilename(args: {
  alcance: AdminCorreccionAlcance;
  asesorNombre: string | null;
  /** Requerido si alcance = periodo_seleccionado. */
  bounds?: Pick<AdminPeriodBounds, "fromDate" | "toDateInclusive"> | null;
  dateYmd?: string;
}): string {
  const who = args.asesorNombre
    ? sanitizeAdminCorreccionesPdfFilenamePart(args.asesorNombre)
    : "TODOS";
  if (args.alcance === "pendientes_actuales") {
    const ymd = args.dateYmd ?? formatAdminCorreccionesPdfTodayYmd();
    return `Correcciones_Pendientes_${who}_${ymd}.pdf`;
  }
  const from = args.bounds?.fromDate ?? "inicio";
  const to = args.bounds?.toDateInclusive ?? "fin";
  return `Correcciones_${who}_${from}_${to}.pdf`;
}

export const ADMIN_CORRECCIONES_PDF_EMPTY_MESSAGE =
  "No hay correcciones pendientes con los filtros seleccionados.";

export function shouldDownloadAdminCorreccionesPdf(
  entries: readonly unknown[],
): boolean {
  return entries.length > 0;
}

function mapDetalleItems(
  detalle: AsesorCorreccionDetalle,
): AdminCorreccionesPdfItemModel[] {
  return detalle.items.map((item) => ({
    typeLabel: adminCorreccionItemTypeLabel(item.type),
    label: (item.label ?? "").trim() || "Sin etiqueta",
    motivo: (item.motivo ?? "").trim() || "Sin motivo registrado",
    localStatusLabel: adminCorreccionPdfLocalStatusLabel(item.local_status),
  }));
}

export function buildAdminCorreccionesReportModel(args: {
  rows: readonly AdminCorreccionEnrichedRow[];
  alcance: AdminCorreccionAlcance;
  /** Requerido si alcance = periodo_seleccionado. */
  bounds: AdminPeriodBounds | null;
  filter: AdminCorreccionFilter;
  asesorNombreSeleccionado: string | null;
  generatedAtIso?: string;
}): AdminCorreccionesPdfReportModel {
  const generatedAtIso = args.generatedAtIso ?? new Date().toISOString();
  const entries: AdminCorreccionesPdfEntryModel[] = [];

  for (const row of args.rows) {
    if (row.readError || !row.detalle?.ux_state) continue;
    const ux = row.detalle.ux_state;
    const mesa = row.mesa;
    const solicitado =
      row.detalle.request_at ??
      row.detalle.items.find((i) => i.requested_at)?.requested_at ??
      null;
    entries.push({
      index: entries.length + 1,
      clienteNombre: (mesa.clienteNombre || "Cliente sin nombre").trim(),
      asesorNombre: formatAdminMesaAsesorLabel(mesa.asesorNombre),
      etapaLabel: (mesa.etapaLabel || String(mesa.etapaActual)).trim(),
      estadoLabel: adminCorreccionUxStateLabel(ux),
      banner: adminCorreccionUxBanner(ux),
      solicitadoAtLabel: solicitado
        ? formatAdminCorreccionesPdfDateTimeMx(solicitado)
        : null,
      items: mapDetalleItems(row.detalle),
    });
  }

  const isPendientes = args.alcance === "pendientes_actuales";
  return {
    title: "Pendientes de corrección",
    asesorLine: args.asesorNombreSeleccionado?.trim()
      ? args.asesorNombreSeleccionado.trim()
      : "Todos los asesores",
    alcanceLine: adminCorreccionAlcanceLabel(args.alcance),
    periodoLine:
      !isPendientes && args.bounds
        ? `${args.bounds.fromDate} — ${args.bounds.toDateInclusive}`
        : null,
    corteLine: isPendientes
      ? formatAdminCorreccionesPdfDateTimeMx(generatedAtIso)
      : null,
    filtroLine: adminCorreccionFilterLabel(args.filter),
    generadoLine: formatAdminCorreccionesPdfDateTimeMx(generatedAtIso),
    total: entries.length,
    entries,
  };
}

/** Texto WinAnsi-safe para Helvetica (pdf-lib). */
export function pdfWinAnsiSafe(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 0x09 || code === 0x0a || code === 0x0d) return " ";
      if (code < 0x20) return "";
      if (code <= 0xff) return ch;
      return "?";
    })
    .join("");
}

/**
 * Heurística anti-PII: el modelo/PDF no debe llevar NSS/RFC/CURP/CLABE crudos
 * ni URLs Storage. Motivos de Mesa pueden mencionar palabras, pero no valores.
 */
export function adminCorreccionesPdfTextLooksLikePii(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/https?:\/\//i.test(t)) return true;
  if (/\b\d{11}\b/.test(t)) return true; // NSS 11 dígitos
  if (/\b\d{18}\b/.test(t)) return true; // CLABE
  if (/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i.test(t)) return true; // RFC
  if (/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i.test(t)) return true; // CURP
  return false;
}

export function collectAdminCorreccionesReportPlainText(
  model: AdminCorreccionesPdfReportModel,
): string {
  const parts: string[] = [
    model.title,
    model.asesorLine,
    model.alcanceLine,
    model.periodoLine ?? "",
    model.corteLine ?? "",
    model.filtroLine,
    model.generadoLine,
    String(model.total),
  ];
  for (const e of model.entries) {
    parts.push(
      e.clienteNombre,
      e.asesorNombre,
      e.etapaLabel,
      e.estadoLabel,
      e.banner ?? "",
      e.solicitadoAtLabel ?? "",
    );
    for (const it of e.items) {
      parts.push(it.typeLabel, it.label, it.motivo, it.localStatusLabel);
    }
  }
  return parts.join("\n");
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const safe = pdfWinAnsiSafe(text);
  const words = safe.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

type DrawCtx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
  pageIndex: number;
};

function ensureSpace(ctx: DrawCtx, needed: number): void {
  if (ctx.y - needed >= MARGIN_BOTTOM) return;
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageIndex += 1;
  ctx.y = PAGE_H - MARGIN_TOP;
}

function drawTextLine(
  ctx: DrawCtx,
  text: string,
  opts: { size: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number },
): void {
  const size = opts.size;
  ensureSpace(ctx, size + 4);
  const font = opts.bold ? ctx.fontBold : ctx.font;
  ctx.page.drawText(pdfWinAnsiSafe(text), {
    x: opts.x ?? MARGIN_X,
    y: ctx.y - size,
    size,
    font,
    color: opts.color ?? COLOR.ink,
  });
  ctx.y -= size + 4;
}

function drawWrapped(
  ctx: DrawCtx,
  text: string,
  opts: {
    size: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    maxWidth?: number;
  },
): void {
  const indent = opts.indent ?? 0;
  const maxWidth = opts.maxWidth ?? CONTENT_W - indent;
  const font = opts.bold ? ctx.fontBold : ctx.font;
  const lines = wrapLines(font, text, opts.size, maxWidth);
  for (const line of lines) {
    drawTextLine(ctx, line, {
      size: opts.size,
      bold: opts.bold,
      color: opts.color,
      x: MARGIN_X + indent,
    });
  }
}

function drawHeader(ctx: DrawCtx, model: AdminCorreccionesPdfReportModel): void {
  const headerH = 72;
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_H - headerH,
    width: PAGE_W,
    height: headerH,
    color: COLOR.headerBg,
  });
  ctx.page.drawText("CONCASA", {
    x: MARGIN_X,
    y: PAGE_H - 28,
    size: 16,
    font: ctx.fontBold,
    color: COLOR.headerFg,
  });
  ctx.page.drawText(pdfWinAnsiSafe(model.title), {
    x: MARGIN_X,
    y: PAGE_H - 50,
    size: 12,
    font: ctx.font,
    color: COLOR.headerFg,
  });
  ctx.y = PAGE_H - headerH - 16;

  drawWrapped(ctx, `Asesor: ${model.asesorLine}`, { size: 10, color: COLOR.muted });
  drawWrapped(ctx, `Alcance: ${model.alcanceLine}`, { size: 10, color: COLOR.muted });
  if (model.periodoLine) {
    drawWrapped(ctx, `Periodo: ${model.periodoLine}`, { size: 10, color: COLOR.muted });
  }
  if (model.corteLine) {
    drawWrapped(ctx, `Corte: ${model.corteLine}`, { size: 10, color: COLOR.muted });
  }
  drawWrapped(ctx, `Filtro: ${model.filtroLine}`, { size: 10, color: COLOR.muted });
  drawWrapped(ctx, `Generado: ${model.generadoLine}`, { size: 10, color: COLOR.muted });
  drawWrapped(ctx, `Total: ${model.total} expedientes`, {
    size: 11,
    bold: true,
    color: COLOR.accent,
  });
  ctx.y -= 8;
}

function estimateCardHeight(
  font: PDFFont,
  fontBold: PDFFont,
  entry: AdminCorreccionesPdfEntryModel,
): number {
  let h = 18 + 14 + 12 * 4 + 8; // title + meta lines
  if (entry.banner) h += 16;
  h += 16; // CORRECCIONES
  for (const it of entry.items) {
    const head = `• ${it.typeLabel} — ${it.label}`;
    h += wrapLines(fontBold, head, 10, CONTENT_W - 12).length * 14;
    h += wrapLines(font, `Motivo: ${it.motivo}`, 9, CONTENT_W - 20).length * 12;
    h += 12; // local status
    h += 6;
  }
  h += 16; // padding + gap
  return h;
}

function drawEntryCard(ctx: DrawCtx, entry: AdminCorreccionesPdfEntryModel): void {
  const minBlock = 90;
  const estimated = estimateCardHeight(ctx.font, ctx.fontBold, entry);
  if (ctx.y - Math.min(estimated, minBlock) < MARGIN_BOTTOM) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.pageIndex += 1;
    ctx.y = PAGE_H - MARGIN_TOP;
  }

  // Separador superior (evita overlay que tape texto).
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: MARGIN_X + CONTENT_W, y: ctx.y },
    thickness: 0.6,
    color: COLOR.cardBorder,
  });
  ctx.y -= 10;

  drawTextLine(ctx, `${entry.index}. ${entry.clienteNombre.toUpperCase()}`, {
    size: 12,
    bold: true,
  });
  drawWrapped(ctx, `Asesor: ${entry.asesorNombre}`, { size: 9, color: COLOR.muted });
  drawWrapped(ctx, `Etapa: ${entry.etapaLabel}`, { size: 9, color: COLOR.muted });
  drawWrapped(ctx, `Estado: ${entry.estadoLabel}`, { size: 9, bold: true });
  if (entry.solicitadoAtLabel) {
    drawWrapped(ctx, `Solicitado por Mesa: ${entry.solicitadoAtLabel}`, {
      size: 9,
      color: COLOR.muted,
    });
  }
  if (entry.banner) {
    const bannerColor =
      entry.banner.includes("ESPERANDO") ? COLOR.bannerGreen : COLOR.bannerAmber;
    drawWrapped(ctx, entry.banner, { size: 9, bold: true, color: bannerColor });
  }
  drawTextLine(ctx, "CORRECCIONES", { size: 10, bold: true, color: COLOR.accent });
  if (entry.items.length === 0) {
    drawWrapped(ctx, "Sin ítems detallados en el read-model.", {
      size: 9,
      color: COLOR.muted,
      indent: 8,
    });
  } else {
    for (const it of entry.items) {
      drawWrapped(ctx, `• ${it.typeLabel} — ${it.label}`, {
        size: 10,
        bold: true,
        indent: 6,
      });
      drawWrapped(ctx, `Motivo: ${it.motivo}`, {
        size: 9,
        indent: 14,
      });
      drawWrapped(ctx, `Estado ítem: ${it.localStatusLabel}`, {
        size: 8,
        color: COLOR.muted,
        indent: 14,
      });
      ctx.y -= 4;
    }
  }
  ctx.y -= 12;
}

export async function renderAdminCorreccionesPdf(
  model: AdminCorreccionesPdfReportModel,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: DrawCtx = {
    doc,
    page,
    y: PAGE_H - MARGIN_TOP,
    font,
    fontBold,
    pageIndex: 0,
  };

  drawHeader(ctx, model);
  for (const entry of model.entries) {
    drawEntryCard(ctx, entry);
  }

  const pages = doc.getPages();
  const totalPages = pages.length;
  for (let i = 0; i < totalPages; i++) {
    const p = pages[i]!;
    const footer = pdfWinAnsiSafe(
      `ConCasa · Reporte de correcciones    Página ${i + 1} de ${totalPages}`,
    );
    p.drawText(footer, {
      x: MARGIN_X,
      y: 24,
      size: 8,
      font,
      color: COLOR.muted,
    });
  }

  return doc.save();
}

export function downloadAdminCorreccionesPdf(
  bytes: Uint8Array,
  filename: string,
): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Pipeline completo testeable sin DOM (salvo download). */
export async function buildAdminCorreccionesPdfBytes(args: {
  rows: readonly AdminCorreccionEnrichedRow[];
  alcance: AdminCorreccionAlcance;
  bounds: AdminPeriodBounds | null;
  filter: AdminCorreccionFilter;
  asesorNombreSeleccionado: string | null;
  generatedAtIso?: string;
}): Promise<{
  model: AdminCorreccionesPdfReportModel;
  bytes: Uint8Array | null;
  empty: boolean;
}> {
  const model = buildAdminCorreccionesReportModel(args);
  if (!shouldDownloadAdminCorreccionesPdf(model.entries)) {
    return { model, bytes: null, empty: true };
  }
  const bytes = await renderAdminCorreccionesPdf(model);
  return { model, bytes, empty: false };
}

/** Helpers de test: mesa stub mínimo. */
export function stubAdminMesaForCorreccionPdf(
  partial: Partial<AdminMesaEnvioEvent> &
    Pick<AdminMesaEnvioEvent, "expedienteId" | "clienteNombre" | "asesorId">,
): AdminMesaEnvioEvent {
  return {
    fechaEnvioMesa: "2026-09-22T15:19:00.000Z",
    asesorNombre: "SILVIA REYES",
    programa: "mejoravit",
    etapaActual: 5,
    etapaLabel: "Integración",
    subestado: "en_proceso",
    cicloEstado: "activo",
    situacionCode: "correccion",
    situacionLabel: "Corrección",
    siguienteAccionLabel: "Corregir",
    siguienteAccionActor: "Asesor",
    ultimaActividadMesaCode: null,
    ultimaActividadMesaLabel: null,
    ultimaActividadMesaAt: null,
    correccionesAbiertasCount: 1,
    correccionAbiertaDesde: "2026-09-22T15:19:00.000Z",
    correccionesReenviadasCount: 0,
    correccionReenviadaDesde: null,
    esperaTipo: null,
    esperaLabel: null,
    esperaDesde: null,
    rechazoOperativo: false,
    rechazoAt: null,
    rechazoClasificacion: null,
    rechazoMotivo: null,
    reingresoActivo: false,
    ...partial,
  };
}
