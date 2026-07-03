/** Opciones de método de pago (sin enum DB). */
export const CLIENTE_METODO_PAGO_OPTIONS = [
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
] as const;

export type ClienteMetodoPago = (typeof CLIENTE_METODO_PAGO_OPTIONS)[number]["value"];

export function parsePorcentajeCobroInput(raw: string): number | null {
  const v = String(raw ?? "").trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseMontoCalculadoInput(raw: string): number | null {
  const v = String(raw ?? "")
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** monto_aprobado × porcentaje / 100, redondeado a 2 decimales. */
export function calcMontoCalculadoCobro(
  montoAprobado: number | null | undefined,
  porcentajeCobro: number | null | undefined,
): number | null {
  if (
    montoAprobado == null ||
    !Number.isFinite(montoAprobado) ||
    montoAprobado <= 0 ||
    porcentajeCobro == null ||
    !Number.isFinite(porcentajeCobro) ||
    porcentajeCobro <= 0
  ) {
    return null;
  }
  return Math.round(montoAprobado * porcentajeCobro * 100) / 10000;
}

export function formatMontoMXN(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function labelMetodoPago(value: string | null | undefined): string {
  const v = String(value ?? "").trim().toLowerCase();
  const found = CLIENTE_METODO_PAGO_OPTIONS.find((o) => o.value === v);
  return found?.label ?? (v ? v : "—");
}
