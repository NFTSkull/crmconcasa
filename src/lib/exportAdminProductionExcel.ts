import * as XLSX from "xlsx";
import { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import type { AdminPeriodBounds } from "@/domain/admin-production/period";
import type { AdminAsesorProductionRow } from "@/domain/admin-production/repo";
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
  mesaEnvios: readonly AdminMesaEnvioEvent[];
  precalificaciones: readonly AdminPrecalEvent[];
  asesores: readonly AdminAsesorProductionRow[];
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const resumen = XLSX.utils.aoa_to_sheet([
    ["Periodo desde", input.bounds.fromDate],
    ["Periodo hasta", input.bounds.toDateInclusive],
    ["Enviados a Mesa", input.summary.enviadosAMesa],
    ["Precalificaciones aprobadas", input.summary.precalificacionesAprobadas],
    ["Aprobadas mayores a 20000", input.summary.aprobadasMayorA20000],
    ["Monto aprobado total", input.summary.montoAprobadoTotal],
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
      "Fecha última actualización",
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
      r.updatedAt,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expAoa), "Expedientes");

  const preAoa: (string | number | null)[][] = [
    [
      "Fecha",
      "Cliente",
      "Asesor",
      "Programa",
      "Decisión",
      "Monto aprobado al aprobar",
      "Monto aprobado actual",
    ],
    ...input.precalificaciones.map((r) => [
      r.aprobadoAt,
      sanitize(r.clienteNombre),
      sanitize(asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId)),
      sanitize(r.programa),
      sanitize(r.decision),
      r.montoAprobadoAlAprobar,
      r.montoAprobadoActual,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(preAoa), "Precalificaciones");

  const asAoa: (string | number | null)[][] = [
    [
      "Asesor",
      "Enviados a Mesa",
      "Precalificaciones aprobadas",
      "Aprobadas >20000",
      "Monto aprobado total",
    ],
    ...input.asesores.map((r) => [
      sanitize(asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId)),
      r.enviadosAMesa,
      r.precalificacionesAprobadas,
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
