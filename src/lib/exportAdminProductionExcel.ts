import * as XLSX from "xlsx";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { formatMontoMX } from "@/lib/monto";
import {
  labelEditorDecision,
  formatPrecalMontoAlAprobarDisplay,
} from "@/domain/admin-production/metrics";
import {
  formatAdminMesaAsesorLabel,
  formatAdminMesaEsperaLabel,
  sanitizeAdminMotivo,
} from "@/domain/admin-production/mesa-seguimiento";
import type { AdminPeriodBounds } from "@/domain/admin-production/period";
import type {
  AdminAsesorProductionRow,
  AdminPrecalSummary,
} from "@/domain/admin-production/repo";
import type {
  AdminMesaEnvioEvent,
  AdminPrecalEvent,
  AdminProductionSummary,
} from "@/domain/admin-production/metrics";

function sanitize(value: string): string {
  const trimmed = value.trim().slice(0, 500);
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

function asesorLabelOther(nombre: string | null, email: string | null, id: string): string {
  return formatAsesorExpedienteLabel({ fullName: nombre, email, fallbackId: id });
}

export type AdminPrecalNssRepeatRow = Readonly<{
  nss: string;
  precalificacionesHistoricas: number;
  expedientesConNss: number;
  filasEnReporte: number;
  clientes: string;
  asesores: string;
  programas: string;
  ultimaFechaEnReporte: string | null;
}>;

export function summarizeAdminPrecalNssRepeats(
  rows: readonly AdminPrecalEvent[],
): AdminPrecalNssRepeatRow[] {
  const grouped = new Map<
    string,
    {
      precalificacionesHistoricas: number;
      expedientesConNss: number;
      filasEnReporte: number;
      clientes: Set<string>;
      asesores: Set<string>;
      programas: Set<string>;
      ultimaFechaEnReporte: string | null;
    }
  >();

  for (const row of rows) {
    const nss = row.nss?.trim() || "";
    if (!nss) continue;
    const current = grouped.get(nss) ?? {
      precalificacionesHistoricas: 1,
      expedientesConNss: 1,
      filasEnReporte: 0,
      clientes: new Set<string>(),
      asesores: new Set<string>(),
      programas: new Set<string>(),
      ultimaFechaEnReporte: null,
    };
    current.precalificacionesHistoricas = Math.max(
      current.precalificacionesHistoricas,
      row.nssPrecalificacionesTotal ?? 1,
    );
    current.expedientesConNss = Math.max(
      current.expedientesConNss,
      row.nssExpedientesTotal ?? 1,
    );
    current.filasEnReporte += 1;
    if (row.clienteNombre.trim()) current.clientes.add(row.clienteNombre.trim());
    const asesor = asesorLabelOther(row.asesorNombre, row.asesorEmail, row.asesorId);
    if (asesor.trim()) current.asesores.add(asesor.trim());
    if (row.programa.trim()) current.programas.add(row.programa.trim());
    if (
      row.fecha &&
      (!current.ultimaFechaEnReporte ||
        Date.parse(row.fecha) > Date.parse(current.ultimaFechaEnReporte))
    ) {
      current.ultimaFechaEnReporte = row.fecha;
    }
    grouped.set(nss, current);
  }

  return [...grouped.entries()]
    .filter(([, value]) => value.precalificacionesHistoricas > 1)
    .map(([nss, value]) => ({
      nss,
      precalificacionesHistoricas: value.precalificacionesHistoricas,
      expedientesConNss: value.expedientesConNss,
      filasEnReporte: value.filasEnReporte,
      clientes: [...value.clientes].sort().join(" | "),
      asesores: [...value.asesores].sort().join(" | "),
      programas: [...value.programas].sort().join(" | "),
      ultimaFechaEnReporte: value.ultimaFechaEnReporte,
    }))
    .sort(
      (a, b) =>
        b.precalificacionesHistoricas - a.precalificacionesHistoricas ||
        b.expedientesConNss - a.expedientesConNss ||
        a.nss.localeCompare(b.nss),
    );
}

export function buildAdminProductionWorkbook(input: {
  bounds: AdminPeriodBounds;
  summary: AdminProductionSummary;
  precalSummary: AdminPrecalSummary;
  mesaEnvios: readonly AdminMesaEnvioEvent[];
  precalificaciones: readonly AdminPrecalEvent[];
  asesores: readonly AdminAsesorProductionRow[];
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const nssRepetidos = summarizeAdminPrecalNssRepeats(input.precalificaciones);
  const nssUnicosEnReporte = new Set(
    input.precalificaciones.map((r) => r.nss?.trim()).filter(Boolean),
  ).size;
  const maxPrecalificacionesPorNss = input.precalificaciones.reduce(
    (max, row) => Math.max(max, row.nssPrecalificacionesTotal ?? 1),
    0,
  );

  const resumen = XLSX.utils.aoa_to_sheet([
    ["Periodo desde", input.bounds.fromDate],
    ["Periodo hasta", input.bounds.toDateInclusive],
    ["Expedientes enviados a Mesa", input.summary.enviadosAMesa],
    ["Precalificaciones aprobadas", input.summary.precalificacionesAprobadas],
    ["Rechazadas (No cumple)", input.summary.precalificacionesNoCumple],
    ["Aprobadas mayores a 20000", input.summary.aprobadasMayorA20000],
    ["Monto aprobado Mejoravit", input.summary.montoAprobadoTotal],
    [],
    ["Resumen bloque Precalificaciones"],
    ["Resueltas", input.precalSummary.resueltasCount],
    ["Aprobadas", input.precalSummary.aprobadasCount],
    ["Rechazadas (No cumple)", input.precalSummary.noCumpleCount],
    ["Pendientes actuales", input.precalSummary.pendientesActualesCount],
    ["Monto aprobado Mejoravit", input.precalSummary.montoMejoravitTotal],
    ["Promedio aprobado Mejoravit", input.precalSummary.montoMejoravitPromedio],
    [],
    ["Control NSS de precalificaciones"],
    ["NSS únicos en este reporte", nssUnicosEnReporte],
    ["NSS con repetición histórica", nssRepetidos.length],
    ["Máximo de precalificaciones para un NSS", maxPrecalificacionesPorNss],
  ]);
  XLSX.utils.book_append_sheet(wb, resumen, "Resumen");

  const expAoa: (string | number | null)[][] = [
    [
      "Fecha envío Mesa",
      "Cliente",
      "Asesor",
      "Etapa actual",
      "Situación actual",
      "Desde envío",
      "Última actividad Mesa",
      "Fecha última actividad",
      "Correcciones abiertas",
      "Corrección pendiente desde",
      "Correcciones reenviadas",
      "Esperando revisión desde",
      "Espera actual",
      "Siguiente acción",
      "Actor esperado",
      "Rechazo operativo",
      "Fecha rechazo",
      "Clasificación",
      "Motivo",
      "Reingreso activo",
    ],
    ...input.mesaEnvios.map((r) => [
      r.fechaEnvioMesa,
      sanitize(r.clienteNombre),
      sanitize(formatAdminMesaAsesorLabel(r.asesorNombre)),
      sanitize(
        r.etapaActual === 10 || /cita para firma/i.test(String(r.etapaLabel ?? ""))
          ? getAdminEtapaDisplayNombre(r.etapaActual)
          : r.etapaLabel || getAdminEtapaDisplayNombre(r.etapaActual),
      ),
      sanitize(r.situacionLabel),
      r.fechaEnvioMesa,
      r.ultimaActividadMesaAt
        ? sanitize(r.ultimaActividadMesaLabel ?? "Sin actividad de Mesa registrada")
        : "Sin actividad de Mesa registrada",
      r.ultimaActividadMesaAt,
      r.correccionesAbiertasCount,
      r.correccionAbiertaDesde,
      r.correccionesReenviadasCount,
      r.correccionReenviadaDesde,
      sanitize(
        formatAdminMesaEsperaLabel({
          esperaLabel: r.esperaLabel,
          esperaDesde: r.esperaDesde,
        }),
      ),
      sanitize(r.siguienteAccionLabel),
      sanitize(r.siguienteAccionActor),
      r.rechazoOperativo ? "Sí" : "No",
      r.rechazoAt,
      r.rechazoClasificacion,
      r.rechazoOperativo ? sanitize(sanitizeAdminMotivo(r.rechazoMotivo)) : null,
      r.reingresoActivo ? "Sí" : "No",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expAoa), "Expedientes");

  const preAoa: (string | number | null)[][] = [
    [
      "Fecha canónica",
      "NSS",
      "Cliente",
      "Asesor",
      "Decisión",
      "Monto al aprobar",
      "Programa",
      "Precalificaciones históricas NSS",
      "Expedientes con este NSS",
      "NSS repetido",
    ],
    ...input.precalificaciones.map((r) => {
      const repeticiones = Math.max(1, r.nssPrecalificacionesTotal ?? 1);
      return [
        r.decision === "pendiente" ? null : r.fecha,
        r.nss?.trim() || null,
        sanitize(r.clienteNombre),
        sanitize(asesorLabelOther(r.asesorNombre, r.asesorEmail, r.asesorId)),
        sanitize(labelEditorDecision(r.decision)),
        r.montoSnapshotNoRecuperable
          ? formatPrecalMontoAlAprobarDisplay(
              {
                montoAprobadoAlAprobar: r.montoAprobadoAlAprobar,
                montoSnapshotNoRecuperable: true,
              },
              formatMontoMX,
            )
          : r.decision === "aprobado"
            ? r.montoAprobadoAlAprobar
            : null,
        sanitize(r.programa),
        repeticiones,
        Math.max(1, r.nssExpedientesTotal ?? 1),
        repeticiones > 1 ? "Sí" : "No",
      ];
    }),
  ];
  const preSheet = XLSX.utils.aoa_to_sheet(preAoa);
  preSheet["!cols"] = [
    { wch: 21 },
    { wch: 14 },
    { wch: 34 },
    { wch: 28 },
    { wch: 22 },
    { wch: 20 },
    { wch: 16 },
    { wch: 28 },
    { wch: 23 },
    { wch: 14 },
  ];
  if (preAoa.length > 1) {
    preSheet["!autofilter"] = { ref: `A1:J${preAoa.length}` };
  }
  XLSX.utils.book_append_sheet(wb, preSheet, "Precalificaciones");

  const repetidosAoa: (string | number | null)[][] = [
    [
      "NSS",
      "Precalificaciones históricas",
      "Expedientes con este NSS",
      "Filas en este reporte",
      "Clientes en este reporte",
      "Asesores en este reporte",
      "Programas",
      "Última fecha en este reporte",
    ],
    ...nssRepetidos.map((r) => [
      r.nss,
      r.precalificacionesHistoricas,
      r.expedientesConNss,
      r.filasEnReporte,
      sanitize(r.clientes),
      sanitize(r.asesores),
      sanitize(r.programas),
      r.ultimaFechaEnReporte,
    ]),
  ];
  const repetidosSheet = XLSX.utils.aoa_to_sheet(repetidosAoa);
  repetidosSheet["!cols"] = [
    { wch: 14 },
    { wch: 28 },
    { wch: 23 },
    { wch: 20 },
    { wch: 42 },
    { wch: 36 },
    { wch: 20 },
    { wch: 25 },
  ];
  if (repetidosAoa.length > 1) {
    repetidosSheet["!autofilter"] = { ref: `A1:H${repetidosAoa.length}` };
  }
  XLSX.utils.book_append_sheet(wb, repetidosSheet, "NSS repetidos");

  const asAoa: (string | number | null)[][] = [
    [
      "Asesor",
      "Enviados a Mesa",
      "Precalificaciones aprobadas",
      "Rechazadas (No cumple)",
      "Aprobadas >20000",
      "Monto aprobado Mejoravit",
    ],
    ...input.asesores.map((r) => [
      sanitize(asesorLabelOther(r.asesorNombre, r.asesorEmail, r.asesorId)),
      r.enviadosAMesa,
      r.precalificacionesAprobadas,
      r.precalificacionesNoCumple,
      r.aprobadasMayorA20000,
      r.montoAprobadoTotal,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(asAoa), "Asesores");

  return wb;
}

export function downloadAdminProductionWorkbook(
  wb: XLSX.WorkBook,
  bounds: AdminPeriodBounds,
): void {
  const name = `produccion-concasa-${bounds.fromDate}_a_${bounds.toDateInclusive}.xlsx`;
  XLSX.writeFile(wb, name);
}

/** Acumula páginas hasta totalCount; aborta si mismatch (sin archivo parcial). */
export async function accumulatePaginatedExport<T>(input: {
  totalCount: number;
  firstPageItems: readonly T[];
  fetchPage: (page: number) => Promise<{ items: readonly T[]; totalCount: number }>;
  label: string;
}): Promise<T[]> {
  const expected = input.totalCount;
  const items: T[] = [...input.firstPageItems];
  let page = 2;
  while (items.length < expected) {
    const next = await input.fetchPage(page);
    if (next.totalCount !== expected) {
      throw new Error(
        `Exportación abortada de ${input.label}: total_count cambió (${expected}→${next.totalCount}). Reintenta.`,
      );
    }
    if (next.items.length === 0) break;
    items.push(...next.items);
    page += 1;
    if (page > 10_000) {
      throw new Error(`Exportación abortada de ${input.label}: demasiadas páginas.`);
    }
  }
  if (items.length !== expected) {
    throw new Error(
      `Exportación incompleta de ${input.label}: recuperadas ${items.length} de ${expected}. Reintenta.`,
    );
  }
  return items;
}

export function assertExportHasNoPii(
  sheetValues: unknown[][],
  options: { allowNss?: boolean } = {},
): void {
  const banned = options.allowNss
    ? /\b(telefono|uuid|http|payload|actor_id|expediente_id)\b/i
    : /\b(nss|telefono|uuid|http|payload|actor_id|expediente_id)\b/i;
  for (const row of sheetValues) {
    for (const cell of row) {
      if (typeof cell === "string" && banned.test(cell)) {
        throw new Error(`Excel contiene PII o campo prohibido: ${cell}`);
      }
    }
  }
}

/** Contrato Mesa: hoja Expedientes sin correo. */
export function assertMesaExportHasNoEmail(sheetValues: unknown[][]): void {
  for (const row of sheetValues) {
    for (const cell of row) {
      if (typeof cell === "string" && cell.includes("@")) {
        throw new Error(`Excel Mesa contiene correo: ${cell}`);
      }
    }
  }
}
