/**
 * P3I.1 — Timeline operativo read-only para asesor (12 etapas).
 */

export const ETAPAS_OPERATIVAS_ASESOR = [
  { id: 1, nombre: "Integración" },
  { id: 2, nombre: "Registro" },
  { id: 3, nombre: "Listo para cita de biométrico" },
  { id: 4, nombre: "Cita agendada (biométricos)" },
  { id: 5, nombre: "Biometría (resultado)" },
  { id: 6, nombre: "Inscripción" },
  { id: 7, nombre: "Notificación" },
  { id: 8, nombre: "Acuse / Aviso de retención" },
  { id: 9, nombre: "Listo para agendar firma" },
  { id: 10, nombre: "Cita para firma" },
  { id: 11, nombre: "Firmado" },
  { id: 12, nombre: "Pago a ConCasa" },
] as const;

export type EtapaOperativaId = (typeof ETAPAS_OPERATIVAS_ASESOR)[number]["id"];

export type EtapaTimelineVisual = "completado" | "actual" | "pendiente";

export function getEtapaOperativaNombre(etapaId: number | null | undefined): string {
  if (etapaId == null) return "—";
  const etapa = ETAPAS_OPERATIVAS_ASESOR.find((e) => e.id === etapaId);
  return etapa?.nombre ?? `Etapa ${etapaId}`;
}

export function resolveEtapaActualOperativa(etapaActual: number | null | undefined): number {
  if (typeof etapaActual === "number" && etapaActual >= 1 && etapaActual <= 12) {
    return etapaActual;
  }
  return 1;
}

export function getEtapaTimelineVisual(
  etapaId: number,
  etapaActual: number | null | undefined,
): EtapaTimelineVisual {
  const actual = resolveEtapaActualOperativa(etapaActual);
  if (etapaId < actual) return "completado";
  if (etapaId === actual) return "actual";
  return "pendiente";
}

export function estadoEnvioMesaLabel(submittedToMesa: boolean): string {
  return submittedToMesa ? "Enviado a Mesa" : "Pendiente de enviar a Mesa";
}

export function asesorSubestadoOperativoLabel(
  subestado: string | null | undefined,
  submittedToMesa: boolean,
): string {
  const s = String(subestado ?? "pendiente").trim();
  if (s === "en_validacion_mesa") return "En validación Mesa";
  if (s === "en_proceso") return "En proceso";
  if (s === "aprobado") return "Aprobado";
  if (s === "rechazado") return "Rechazado";
  if (!submittedToMesa) return "Pendiente";
  return "Pendiente";
}

export function getEtapaTimelineBadgeLabel(
  visual: EtapaTimelineVisual,
  etapaId: number,
  subestado: string | null | undefined,
  submittedToMesa: boolean,
): string {
  if (visual === "completado") return "Completado";
  if (visual === "pendiente") return "Pendiente";

  if (
    etapaId === 1 &&
    submittedToMesa &&
    String(subestado ?? "").trim() === "en_validacion_mesa"
  ) {
    return "En validación Mesa";
  }

  const sub = String(subestado ?? "pendiente").trim();
  if (sub === "en_proceso") return "En proceso";
  if (sub === "aprobado") return "Completado";
  if (sub === "rechazado") return "Rechazado";
  if (!submittedToMesa && etapaId === 1) return "Pendiente";
  return "En proceso";
}

export function etapaTimelineBadgeClass(visual: EtapaTimelineVisual, badgeLabel: string): string {
  if (visual === "completado" || badgeLabel === "Completado") {
    return "bg-green-50 text-green-800 border border-green-200";
  }
  if (badgeLabel === "En validación Mesa") {
    return "bg-blue-600 text-white border border-blue-600";
  }
  if (badgeLabel === "En proceso") {
    return "bg-blue-50 text-blue-800 border border-blue-200";
  }
  if (badgeLabel === "Rechazado") {
    return "bg-red-50 text-red-800 border border-red-200";
  }
  if (visual === "actual") {
    return "bg-amber-50 text-amber-900 border border-amber-200";
  }
  return "bg-gray-50 text-gray-700 border border-gray-200";
}

export function etapaTimelineCardClass(visual: EtapaTimelineVisual): string {
  if (visual === "completado") {
    return "border-green-400 bg-green-50";
  }
  if (visual === "actual") {
    return "border-blue-500 bg-blue-50";
  }
  return "border-gray-200 bg-gray-50";
}

export function etapaTimelineCircleClass(visual: EtapaTimelineVisual): string {
  if (visual === "completado") return "bg-green-500 text-white";
  if (visual === "actual") return "bg-blue-600 text-white";
  return "bg-gray-200 text-gray-800";
}

export const MSJ_SEGUIMIENTO_PRE_ENVIO =
  "El seguimiento operativo inicia al enviar a Mesa.";
