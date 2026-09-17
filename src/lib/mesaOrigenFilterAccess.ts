import type { MesaOpsFilter } from "@/lib/mesaOpsUi";

const SARA_KASS_ORIGEN_FILTER_EMAILS = new Set([
  "mesa.interno03@concasa.mx",
  "mesa.interno04@concasa.mx",
]);

const ORIGEN_FILTER_OPS = new Set<MesaOpsFilter>([
  "sin_asignar",
  "todo_mesa",
]);

/** Roles administrativos que ya tenían el selector global de origen. */
export function isMesaAdminOrigenFilterRole(
  role: string | null | undefined,
): boolean {
  const normalized = String(role ?? "").trim();
  return normalized === "mesa_control_admin" || normalized === "mesa_control";
}

/** Sara y Kass: Mesa interno con alcance adicional de externos en Production. */
export function isSaraKassOrigenOperator(params: {
  email?: string | null;
  role?: string | null;
}): boolean {
  const role = String(params.role ?? "").trim();
  if (role !== "mesa_control_interno") return false;
  const email = String(params.email ?? "").trim().toLowerCase();
  return SARA_KASS_ORIGEN_FILTER_EMAILS.has(email);
}

/**
 * Para Sara/Kass el filtro pequeño solo aparece en Disponibles y Todo Mesa.
 * Administración conserva su selector global existente.
 */
export function shouldShowMesaOperatorOrigenFilter(params: {
  email?: string | null;
  role?: string | null;
  opsFilter: MesaOpsFilter;
}): boolean {
  return (
    isSaraKassOrigenOperator(params) &&
    ORIGEN_FILTER_OPS.has(params.opsFilter)
  );
}
