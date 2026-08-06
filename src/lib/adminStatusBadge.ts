/**
 * Admin UX B2 — badge de situación a partir de campos ya presentes en Admin.
 * Solo mapeo visual de tonos; no inventa estados ni cambia códigos.
 */

export type AdminStatusTone =
  | "neutral"
  | "info"
  | "warning"
  | "danger"
  | "success";

export type AdminStatusBadgeInput = Readonly<{
  situacionLabel: string;
  situacionCode?: string | null;
  cicloEstado?: string | null;
  rechazoOperativo?: boolean;
  correccionesAbiertasCount?: number;
}>;

const TONE_CLASS: Record<AdminStatusTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-800",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-red-200 bg-red-50 text-red-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

/**
 * Elige el tono a partir de señales ya existentes (rechazo, corrección,
 * ciclo, texto de situación). El label visible sigue siendo situacionLabel.
 */
export function resolveAdminStatusTone(
  input: AdminStatusBadgeInput,
): AdminStatusTone {
  const ciclo = (input.cicloEstado ?? "").trim().toLowerCase();
  const code = (input.situacionCode ?? "").trim().toLowerCase();
  const label = input.situacionLabel.trim().toLowerCase();

  if (input.rechazoOperativo || ciclo === "rechazado" || ciclo === "cancelado") {
    return "danger";
  }
  if (
    (input.correccionesAbiertasCount ?? 0) > 0 ||
    code.includes("correccion") ||
    label.includes("corrección") ||
    label.includes("correccion")
  ) {
    return "warning";
  }
  if (
    ciclo === "finalizado" ||
    code.includes("aprobad") ||
    label.includes("aprobad") ||
    label.includes("complet") ||
    label.includes("firmado")
  ) {
    return "success";
  }
  if (
    code.includes("validacion") ||
    code.includes("mesa") ||
    label.includes("validación") ||
    label.includes("validacion") ||
    label.includes("mesa")
  ) {
    return "info";
  }
  return "neutral";
}

export function adminStatusToneClass(tone: AdminStatusTone): string {
  return TONE_CLASS[tone];
}
