import * as XLSX from "xlsx";
import { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { formatMontoMX } from "@/lib/monto";
import { labelEditorDecision, formatPrecalMontoAlAprobarDisplay } from "@/domain/admin-production/metrics";
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
  const trimmed = value.trim();
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

function asesorLabel(nombre: string | null, email: string | null, id: string): string {
  return formatAsesorExpedienteLabel({ fullName: nombre, email, fallbackId: id });
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
  ]);
  XLSX.utils.book_append_sheet(wb, resumen, "Resumen");

  const expAoa: (string | number | null)[][] = [
    [
      "Fecha envío Mesa",
      "Cliente",
      "Asesor",
      "Programa",
      "Etapa actual",
      "Etiqueta etapa",
      "Estado/subestado",
      "Monto aprobado al aprobar",
      "Monto aprobado actual",
    ],
    ...input.mesaEnvios.map((r) => [
      r.fechaEnvioMesa,
      sanitize(r.clienteNombre),
      sanitize(asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId)),
      sanitize(r.programa),
      r.etapaActual,
      getEtapaOperativaNombre(r.etapaActual),
      sanitize(`${r.cicloEstado} / ${r.subestado}`),
      r.montoAprobadoAlAprobar,
      r.montoAprobadoActual,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expAoa), "Expedientes");

  const preAoa: (string | number | null)[][] = [
    [
      "Fecha canónica",
      "Cliente",
      "Asesor",
      "Decisión",
      "Monto al aprobar",
      "Programa",
    ],
    ...input.precalificaciones.map((r) => [
      r.decision === "pendiente" ? null : r.fecha,
      sanitize(r.clienteNombre),
      sanitize(asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId)),
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
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(preAoa), "Precalificaciones");

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
      sanitize(asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId)),
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

/** Acumula páginas hasta totalCount; falla si hay mismatch (sin truncar). */
export async function accumulatePaginatedExport<T>(input: {
  totalCount: number;
  firstPageItems: readonly T[];
  fetchPage: (page: number) => Promise<readonly T[]>;
  label: string;
}): Promise<T[]> {
  const items: T[] = [...input.firstPageItems];
  let page = 2;
  while (items.length < input.totalCount) {
    const next = await input.fetchPage(page);
    if (next.length === 0) break;
    items.push(...next);
    page += 1;
  }
  if (items.length !== input.totalCount) {
    throw new Error(
      `Exportación incompleta de ${input.label}: recuperadas ${items.length} de ${input.totalCount}. Reintenta.`,
    );
  }
  return items;
}

export function assertExportHasNoPii(sheetValues: unknown[][]): void {
  const banned = /\b(nss|telefono|uuid|http)\b/i;
  for (const row of sheetValues) {
    for (const cell of row) {
      if (typeof cell === "string" && banned.test(cell)) {
        throw new Error(`Excel contiene PII o campo prohibido: ${cell}`);
      }
    }
  }
}
