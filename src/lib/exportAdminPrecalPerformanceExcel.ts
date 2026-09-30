import * as XLSX from "xlsx";

import {
  fetchAdminPrecalPerformance,
  type AdminPrecalPerformanceAdvisor,
  type AdminPrecalPerformanceItem,
  type AdminPrecalPerformanceResult,
} from "@/domain/admin-precal-performance";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import { labelEditorDecision } from "@/domain/admin-production";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { formatDateTimeMx } from "@/lib/filters";

const EXPORT_PAGE_SIZE = 100;

function safeText(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim().slice(0, 500);
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

function advisorLabel(
  nombre: string | null,
  email: string | null,
  id: string,
): string {
  return formatAsesorExpedienteLabel({
    fullName: nombre,
    email,
    fallbackId: id,
  });
}

function originLabel(item: AdminPrecalPerformanceItem): string {
  if (!item.precalificadorOrigenId) return "Asesor titular";
  return (
    item.precalificadorNombre?.trim() ||
    item.precalificadorEmail?.trim() ||
    "Usuario precalificador"
  );
}

function formatPct(value: number): number {
  return Number.isFinite(value) ? value / 100 : 0;
}

function periodDate(iso: string, subtractMs = 0): string {
  const date = new Date(new Date(iso).getTime() - subtractMs);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function setTextColumn(sheet: XLSX.WorkSheet, columnLetter: string, rows: number) {
  for (let row = 2; row <= rows; row += 1) {
    const ref = `${columnLetter}${row}`;
    const cell = sheet[ref];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }
}

function applySheetLayout(
  sheet: XLSX.WorkSheet,
  widths: number[],
  ref: string,
): void {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref };
}

function buildSharedRows(
  items: readonly AdminPrecalPerformanceItem[],
): (string | number | null)[][] {
  const seen = new Set<string>();
  const rows: (string | number | null)[][] = [];

  for (const item of items) {
    const nss = item.nss.trim();
    if (!nss || !item.compartidoEntreAsesores || seen.has(nss)) continue;
    seen.add(nss);

    for (const advisor of item.asesoresNss) {
      rows.push([
        nss,
        item.asesoresNssCount,
        safeText(advisorLabel(advisor.asesorNombre, advisor.asesorEmail, advisor.asesorId)),
        advisor.precalificaciones,
        advisor.reprecalificaciones,
        advisor.aprobadas,
        advisor.noCumple,
        advisor.pendientes,
        advisor.expedientes,
        advisor.expedientesEnMesa,
        advisor.montoPromedio,
      ]);
    }
  }

  return rows.sort((a, b) => {
    const nssCompare = String(a[0] ?? "").localeCompare(String(b[0] ?? ""));
    if (nssCompare !== 0) return nssCompare;
    return Number(b[3] ?? 0) - Number(a[3] ?? 0);
  });
}

export async function fetchAllAdminPrecalPerformanceForExcel(input: {
  fromIso: string;
  toExclusiveIso: string;
  asesorId?: string | null;
  search?: string | null;
}): Promise<AdminPrecalPerformanceResult> {
  const first = await fetchAdminPrecalPerformance({
    ...input,
    page: 1,
    pageSize: EXPORT_PAGE_SIZE,
    detailFilter: "todos",
  });

  const items: AdminPrecalPerformanceItem[] = [...first.items];
  let page = 2;

  while (items.length < first.totalCount) {
    const next = await fetchAdminPrecalPerformance({
      ...input,
      page,
      pageSize: EXPORT_PAGE_SIZE,
      detailFilter: "todos",
    });

    if (next.totalCount !== first.totalCount) {
      throw new Error(
        `La información cambió durante la exportación (${first.totalCount}→${next.totalCount}). Reintenta para evitar un Excel incompleto.`,
      );
    }
    if (next.items.length === 0) {
      throw new Error(
        `Exportación incompleta: se recuperaron ${items.length} de ${first.totalCount} precalificaciones.`,
      );
    }
    items.push(...next.items);
    page += 1;

    if (page > 10_000) {
      throw new Error("Exportación abortada: demasiadas páginas.");
    }
  }

  return {
    ...first,
    items,
    page: 1,
    pageSize: items.length || EXPORT_PAGE_SIZE,
    detailFilter: "todos",
  };
}

export function buildAdminPrecalPerformanceWorkbook(input: {
  data: AdminPrecalPerformanceResult;
  fromIso: string;
  toExclusiveIso: string;
  periodoLabel: string;
  asesorFiltroLabel?: string | null;
  search?: string | null;
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { data } = input;
  const summary = data.summary;
  const fromDate = periodDate(input.fromIso);
  const toDate = periodDate(input.toExclusiveIso, 1);
  const advisorFilter = input.asesorFiltroLabel?.trim() || "Todos los asesores";
  const searchFilter = input.search?.trim() || "Sin búsqueda";

  const resumenAoa: (string | number | null)[][] = [
    ["REPORTE DE RENDIMIENTO DE PRECALIFICACIONES"],
    ["Periodo", input.periodoLabel],
    ["Desde", fromDate],
    ["Hasta", toDate],
    ["Asesor", advisorFilter],
    ["Búsqueda", searchFilter],
    [],
    ["MÉTRICAS"],
    ["Precalificaciones", summary.totalPrecalificaciones],
    ["NSS únicos", summary.nssUnicos],
    ["Re-precalificaciones", summary.reprecalificaciones],
    ["NSS compartidos entre asesores", summary.nssCompartidos],
    ["Aprobadas", summary.aprobadas],
    ["No cumple", summary.noCumple],
    ["Pendientes", summary.pendientes],
    ["% aprobación", formatPct(summary.tasaAprobacionPct)],
    ["Monto promedio aprobado", summary.montoPromedio],
    ["Monto aprobado operativo", summary.montoTotalAdmin],
    ["Casos precalificados distintos", summary.expedientesGenerados],
    ["Expedientes enviados a Mesa", summary.expedientesEnMesa],
    ["% conversión a Mesa", formatPct(summary.conversionMesaPct)],
    ["NSS topados $169,000", summary.topadosNss],
    ["Topados enviados a Mesa", summary.topadosNssEnMesa],
    ["% conversión topados", formatPct(summary.topadosConversionPct)],
    [],
    ["DEFINICIONES"],
    [
      "Re-precalificación",
      "El mismo expediente vuelve a consultarse. No cuenta como NSS compartido.",
    ],
    [
      "NSS compartido",
      "El mismo NSS fue precalificado por dos o más asesores distintos dentro del periodo.",
    ],
    [
      "Expediente enviado a Mesa",
      "Caso que sí fue enviado a Mesa; no es simplemente un registro creado por una precalificación.",
    ],
    [
      "Tope Mejoravit",
      "$169,000 para monto promedio y monto operativo del panel.",
    ],
  ];
  const resumen = XLSX.utils.aoa_to_sheet(resumenAoa);
  resumen["!cols"] = [{ wch: 34 }, { wch: 72 }];
  for (const ref of ["B16", "B21", "B24"]) {
    if (resumen[ref]) resumen[ref].z = "0.0%";
  }
  for (const ref of ["B17", "B18"]) {
    if (resumen[ref]) resumen[ref].z = "$#,##0.00";
  }
  XLSX.utils.book_append_sheet(wb, resumen, "Resumen");

  const advisorAoa: (string | number | null)[][] = [
    [
      "Asesor",
      "Precalificaciones",
      "NSS únicos",
      "Re-precalificaciones",
      "NSS compartidos",
      "Casos precalificados distintos",
      "Aprobadas",
      "No cumple",
      "Pendientes",
      "% aprobación",
      "Monto promedio",
      "Topados $169k",
      "Topados a Mesa",
      "Expedientes a Mesa",
      "% conversión a Mesa",
    ],
    ...data.asesores.map((row: AdminPrecalPerformanceAdvisor) => [
      safeText(advisorLabel(row.asesorNombre, row.asesorEmail, row.asesorId)),
      row.totalPrecalificaciones,
      row.nssUnicos,
      row.reprecalificaciones,
      row.nssCompartidos,
      row.expedientesGenerados,
      row.aprobadas,
      row.noCumple,
      row.pendientes,
      formatPct(row.tasaAprobacionPct),
      row.montoPromedio,
      row.topadosNss,
      row.topadosNssEnMesa,
      row.expedientesEnMesa,
      formatPct(row.conversionMesaPct),
    ]),
  ];
  const advisors = XLSX.utils.aoa_to_sheet(advisorAoa);
  applySheetLayout(
    advisors,
    [32, 18, 14, 20, 18, 28, 12, 12, 12, 16, 18, 16, 18, 20, 20],
    `A1:O${advisorAoa.length}`,
  );
  for (let row = 2; row <= advisorAoa.length; row += 1) {
    if (advisors[`J${row}`]) advisors[`J${row}`].z = "0.0%";
    if (advisors[`K${row}`]) advisors[`K${row}`].z = "$#,##0.00";
    if (advisors[`O${row}`]) advisors[`O${row}`].z = "0.0%";
  }
  XLSX.utils.book_append_sheet(wb, advisors, "Rendimiento por asesor");

  const detailAoa: (string | number | null)[][] = [
    [
      "Fecha",
      "NSS",
      "Cliente",
      "Asesor titular",
      "Origen de captura",
      "Tipo de precalificación",
      "NSS compartido",
      "# asesores con NSS",
      "Asesores que comparten NSS",
      "Resultado",
      "Monto aprobado",
      "Topado $169k",
      "Expediente a Mesa",
      "Fecha envío Mesa",
      "Etapa actual",
      "Programa",
      "Precalificaciones del NSS en periodo",
      "Precalificaciones históricas NSS",
    ],
    ...data.items.map((item) => [
      item.fecha ? formatDateTimeMx(item.fecha) : null,
      item.nss.trim() || null,
      safeText(item.clienteNombre),
      safeText(advisorLabel(item.asesorNombre, item.asesorEmail, item.asesorId)),
      safeText(originLabel(item)),
      item.isReprecalificacion ? "Re-precalificación" : "Inicial",
      item.compartidoEntreAsesores ? "Sí" : "No",
      item.asesoresNssCount,
      safeText(
        item.asesoresNss
          .map((advisor) =>
            advisorLabel(advisor.asesorNombre, advisor.asesorEmail, advisor.asesorId),
          )
          .join(" | "),
      ),
      safeText(labelEditorDecision(item.decision)),
      item.montoAprobado,
      item.topado169k ? "Sí" : "No",
      item.submittedToMesa ? "Sí" : "No",
      item.fechaEnvioMesa ? formatDateTimeMx(item.fechaEnvioMesa) : null,
      safeText(getAdminEtapaDisplayNombre(item.etapaActual)),
      safeText(item.programa),
      item.nssPrecalPeriodo,
      item.nssPrecalHistoricas,
    ]),
  ];
  const detail = XLSX.utils.aoa_to_sheet(detailAoa);
  applySheetLayout(
    detail,
    [21, 14, 34, 30, 28, 22, 16, 18, 54, 18, 18, 15, 20, 21, 24, 16, 28, 30],
    `A1:R${detailAoa.length}`,
  );
  setTextColumn(detail, "B", detailAoa.length);
  for (let row = 2; row <= detailAoa.length; row += 1) {
    if (detail[`K${row}`]) detail[`K${row}`].z = "$#,##0.00";
  }
  XLSX.utils.book_append_sheet(wb, detail, "Todas las precalificaciones");

  const sharedAoa: (string | number | null)[][] = [
    [
      "NSS",
      "# asesores",
      "Asesor",
      "Precalificaciones del NSS",
      "Re-precalificaciones",
      "Aprobadas",
      "No cumple",
      "Pendientes",
      "Casos distintos",
      "Expedientes a Mesa",
      "Monto promedio",
    ],
    ...buildSharedRows(data.items),
  ];
  const shared = XLSX.utils.aoa_to_sheet(sharedAoa);
  applySheetLayout(
    shared,
    [14, 14, 34, 24, 20, 12, 12, 12, 16, 20, 18],
    `A1:K${sharedAoa.length}`,
  );
  setTextColumn(shared, "A", sharedAoa.length);
  for (let row = 2; row <= sharedAoa.length; row += 1) {
    if (shared[`K${row}`]) shared[`K${row}`].z = "$#,##0.00";
  }
  XLSX.utils.book_append_sheet(wb, shared, "NSS compartidos");

  const reprecalAoa: (string | number | null)[][] = [
    [
      "Fecha",
      "NSS",
      "Cliente",
      "Asesor titular",
      "Resultado",
      "Monto aprobado",
      "NSS compartido",
      "Expediente a Mesa",
      "Etapa actual",
    ],
    ...data.items
      .filter((item) => item.isReprecalificacion)
      .map((item) => [
        item.fecha ? formatDateTimeMx(item.fecha) : null,
        item.nss.trim() || null,
        safeText(item.clienteNombre),
        safeText(advisorLabel(item.asesorNombre, item.asesorEmail, item.asesorId)),
        safeText(labelEditorDecision(item.decision)),
        item.montoAprobado,
        item.compartidoEntreAsesores ? "Sí" : "No",
        item.submittedToMesa ? "Sí" : "No",
        safeText(getAdminEtapaDisplayNombre(item.etapaActual)),
      ]),
  ];
  const reprecal = XLSX.utils.aoa_to_sheet(reprecalAoa);
  applySheetLayout(
    reprecal,
    [21, 14, 34, 30, 18, 18, 18, 20, 24],
    `A1:I${reprecalAoa.length}`,
  );
  setTextColumn(reprecal, "B", reprecalAoa.length);
  for (let row = 2; row <= reprecalAoa.length; row += 1) {
    if (reprecal[`F${row}`]) reprecal[`F${row}`].z = "$#,##0.00";
  }
  XLSX.utils.book_append_sheet(wb, reprecal, "Re-precalificaciones");

  return wb;
}

export function downloadAdminPrecalPerformanceWorkbook(input: {
  wb: XLSX.WorkBook;
  fromIso: string;
  toExclusiveIso: string;
}): void {
  const fromDate = periodDate(input.fromIso);
  const toDate = periodDate(input.toExclusiveIso, 1);
  XLSX.writeFile(
    input.wb,
    `precalificaciones-concasa-${fromDate}_a_${toDate}.xlsx`,
  );
}
