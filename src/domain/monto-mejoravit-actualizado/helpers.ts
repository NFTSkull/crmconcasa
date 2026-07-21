/** Helpers puros P090 — Monto actualizado Mejoravit (UI). */

export const MONTO_MEJORAVIT_NUMERIC_MAX = 9_999_999_999.99;
export const MONTO_MEJORAVIT_MOTIVO_MAX = 500;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Vista previa de cobro: ROUND(monto × % / 100 + cargoFijo, 2).
 * No usa el cobro anterior como base.
 */
export function calculateUpdatedCobro(
  monto: number,
  porcentaje: number,
  cargoFijo: number,
): number {
  return roundMoney((monto * porcentaje) / 100 + cargoFijo);
}

export function calculateMontoDifference(
  montoNuevo: number,
  montoVigente: number,
): number {
  return roundMoney(montoNuevo - montoVigente);
}

export function describeMontoDifference(diferencia: number): Readonly<{
  kind: "aumento" | "disminucion" | "igual";
  abs: number;
  signedLabel: string;
  proseLabel: string;
}> {
  const abs = roundMoney(Math.abs(diferencia));
  const money = formatMoneyMx(abs);
  if (diferencia > 0) {
    return {
      kind: "aumento",
      abs,
      signedLabel: `+${money}`,
      proseLabel: `Aumento de ${money}`,
    };
  }
  if (diferencia < 0) {
    return {
      kind: "disminucion",
      abs,
      signedLabel: `-${money}`,
      proseLabel: `Disminución de ${money}`,
    };
  }
  return {
    kind: "igual",
    abs: 0,
    signedLabel: formatMoneyMx(0),
    proseLabel: "Sin diferencia",
  };
}

const moneyFmt = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export function formatMoneyMx(value: number): string {
  return moneyFmt.format(value);
}

export function formatDateTimeEsMx(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

export type ValidateMontoMejoravitUpdateInput = Readonly<{
  montoNuevoRaw: string;
  motivoRaw: string;
  montoVigente: number | null;
  porcentajeCobro: number | null;
}>;

export type ValidateMontoMejoravitUpdateResult =
  | Readonly<{ ok: true; montoNuevo: number; motivo: string }>
  | Readonly<{ ok: false; error: string }>;

/** Parsea monto de input UI (acepta coma o punto decimal). */
export function parseMontoInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, "");
  // Si hay una sola coma como decimal estilo es-MX: 200000,50
  const esStyle = trimmed.match(/^-?\d{1,3}(\.\d{3})*,\d{1,2}$|^-?\d+,\d{1,2}$/);
  const candidate = esStyle
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : normalized;
  const n = Number(candidate);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function validateMontoMejoravitUpdate(
  input: ValidateMontoMejoravitUpdateInput,
): ValidateMontoMejoravitUpdateResult {
  if (input.porcentajeCobro == null) {
    return {
      ok: false,
      error:
        "No existe un porcentaje de cobro registrado. Debe capturarse antes de actualizar el monto.",
    };
  }
  if (input.porcentajeCobro <= 0 || input.porcentajeCobro > 100) {
    return {
      ok: false,
      error: "El porcentaje de cobro registrado no es válido.",
    };
  }

  const parsed = parseMontoInput(input.montoNuevoRaw);
  if (parsed == null) {
    return { ok: false, error: "El monto nuevo es obligatorio y debe ser numérico." };
  }
  if (parsed <= 0) {
    return { ok: false, error: "El monto nuevo debe ser mayor que cero." };
  }
  if (parsed > MONTO_MEJORAVIT_NUMERIC_MAX) {
    return {
      ok: false,
      error: "El monto nuevo excede el máximo permitido.",
    };
  }

  const montoNuevo = roundMoney(parsed);
  if (input.montoVigente != null) {
    const vigente = roundMoney(input.montoVigente);
    if (montoNuevo === vigente) {
      return {
        ok: false,
        error: "El monto nuevo debe ser diferente al monto vigente.",
      };
    }
  }

  const motivo = input.motivoRaw.trim();
  if (!motivo) {
    return { ok: false, error: "El motivo de actualización es obligatorio." };
  }
  if (motivo.length > MONTO_MEJORAVIT_MOTIVO_MAX) {
    return {
      ok: false,
      error: `El motivo no puede exceder ${MONTO_MEJORAVIT_MOTIVO_MAX} caracteres.`,
    };
  }

  return { ok: true, montoNuevo, motivo };
}
