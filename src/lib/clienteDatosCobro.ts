import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";

/** Opciones de método de pago (sin enum DB). */
export const CLIENTE_METODO_PAGO_OPTIONS = [
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
] as const;

export type ClienteMetodoPago = (typeof CLIENTE_METODO_PAGO_OPTIONS)[number]["value"];

export const MONTO_MEJORAVIT_TOPE = 169000;
export const MONTO_MEJORAVIT_FACTOR = 0.89;
export const MONTO_CALCULADO_COBRO_BASE_FIJA = 3000;

export type CalcMontoCalculadoCobroContext = {
  programaDb?: string | null;
  montoMejoravitForm?: string | null;
};

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

/** Monto Mejoravit sugerido: min(round(monto_editor × 0.89, 2), 169000). */
export function calcMontoMejoravitDesdeEditor(montoEditor: number): number {
  if (!Number.isFinite(montoEditor) || montoEditor <= 0) return 0;
  const montoMenosOnce =
    Math.round(montoEditor * MONTO_MEJORAVIT_FACTOR * 100) / 100;
  return Math.min(montoMenosOnce, MONTO_MEJORAVIT_TOPE);
}

export function isProgramaMejoravitDb(programaDb: string | null | undefined): boolean {
  return String(programaDb ?? "").trim().toLowerCase() === "mejoravit";
}

export function isMontoMejoravitGuardado(raw: string | null | undefined): boolean {
  const n = parseMontoCalculadoInput(String(raw ?? ""));
  return n != null && n > 0;
}

function resolveCalcCobroContext(
  context?: string | null | CalcMontoCalculadoCobroContext,
): CalcMontoCalculadoCobroContext {
  if (context == null || typeof context === "string") {
    return { programaDb: context };
  }
  return context;
}

/** Base sugerida desde editor (solo autopoblado; no usar para cobro si hay valor manual). */
export function calcBaseCobroDesdeMontoEditor(
  programaDb: string | null | undefined,
  montoEditor: number | null | undefined,
): number | null {
  if (montoEditor == null || !Number.isFinite(montoEditor) || montoEditor <= 0) {
    return null;
  }
  if (isProgramaMejoravitDb(programaDb)) {
    const mejoravit = calcMontoMejoravitDesdeEditor(montoEditor);
    return mejoravit > 0 ? mejoravit : null;
  }
  return montoEditor;
}

/** Base de cobro: Mejoravit usa montoMejoravit del formulario; otros programas usan monto editor. */
export function calcBaseCobro(
  programaDb: string | null | undefined,
  montoEditor: number | null | undefined,
  montoMejoravitForm?: string | null,
): number | null {
  if (isProgramaMejoravitDb(programaDb)) {
    const fromForm = parseMontoCalculadoInput(montoMejoravitForm ?? "");
    return fromForm != null && fromForm > 0 ? fromForm : null;
  }
  if (montoEditor == null || !Number.isFinite(montoEditor) || montoEditor <= 0) {
    return null;
  }
  return montoEditor;
}

/** baseCobro × porcentaje / 100 + $3,000, redondeado a 2 decimales. */
export function calcMontoCalculadoCobro(
  montoEditor: number | null | undefined,
  porcentajeCobro: number | null | undefined,
  context?: string | null | CalcMontoCalculadoCobroContext,
): number | null {
  const { programaDb, montoMejoravitForm } = resolveCalcCobroContext(context);
  const baseCobro = calcBaseCobro(programaDb, montoEditor, montoMejoravitForm);
  if (
    baseCobro == null ||
    porcentajeCobro == null ||
    !Number.isFinite(porcentajeCobro) ||
    porcentajeCobro <= 0
  ) {
    return null;
  }
  return (
    Math.round(
      ((baseCobro * porcentajeCobro) / 100 + MONTO_CALCULADO_COBRO_BASE_FIJA) *
        100,
    ) / 100
  );
}

export function formatMontoMejoravitDesdeEditor(montoEditor: number | null | undefined): string {
  if (montoEditor == null || !Number.isFinite(montoEditor) || montoEditor <= 0) {
    return "";
  }
  return String(calcMontoMejoravitDesdeEditor(montoEditor));
}

/** Solo sugiere monto si el campo está vacío (no pisa valor guardado o editado). */
export function applyMontoMejoravitSugeridoSiVacio(
  datos: ClienteDatosFormShape,
  programaDb: string | null | undefined,
  montoEditor: number | null | undefined,
): ClienteDatosFormShape {
  if (!isProgramaMejoravitDb(programaDb)) {
    return { ...datos, montoMejoravit: "", plazo: "" };
  }
  if (isMontoMejoravitGuardado(datos.montoMejoravit)) {
    return datos;
  }
  if (montoEditor == null || !Number.isFinite(montoEditor) || montoEditor <= 0) {
    return { ...datos, montoMejoravit: "" };
  }
  return {
    ...datos,
    montoMejoravit: formatMontoMejoravitDesdeEditor(montoEditor),
  };
}

export function isMontoCalculadoGuardado(raw: string | null | undefined): boolean {
  const n = parseMontoCalculadoInput(String(raw ?? ""));
  return n != null && n > 0;
}

export function montosCalculadosEquivalentes(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** True si el valor guardado difiere del cálculo automático actual (edición manual). */
export function isMontoCalculadoManualRespectoAuto(
  montoForm: string | null | undefined,
  montoAuto: number | null,
): boolean {
  const saved = parseMontoCalculadoInput(String(montoForm ?? ""));
  if (saved == null || saved <= 0) return false;
  if (montoAuto == null) return false;
  return !montosCalculadosEquivalentes(saved, montoAuto);
}

export function cobroInputsAfectanMontoCalculado(
  prev: ClienteDatosFormShape,
  next: ClienteDatosFormShape,
): boolean {
  return (
    prev.porcentajeCobro !== next.porcentajeCobro ||
    prev.montoMejoravit !== next.montoMejoravit
  );
}

export function porcentajeCobroCambio(
  prev: ClienteDatosFormShape,
  next: ClienteDatosFormShape,
): boolean {
  return prev.porcentajeCobro !== next.porcentajeCobro;
}

export function montoCalculadoFieldCambio(
  prev: ClienteDatosFormShape,
  next: ClienteDatosFormShape,
): boolean {
  return prev.montoCalculado !== next.montoCalculado;
}

/**
 * Recalcula monto calculado tras editar cobro, respetando override manual salvo
 * cambio de porcentaje o borrado del campo.
 */
export function applyClienteDatosCobroRecalc(params: {
  prev: ClienteDatosFormShape;
  next: ClienteDatosFormShape;
  montoEditor: number | null | undefined;
  programaDb: string | null | undefined;
  bloqueadoManual: boolean;
}): { datos: ClienteDatosFormShape; bloqueadoManual: boolean } {
  let bloqueado = params.bloqueadoManual;

  if (
    montoCalculadoFieldCambio(params.prev, params.next) &&
    !isMontoCalculadoGuardado(params.next.montoCalculado)
  ) {
    bloqueado = false;
  }

  if (porcentajeCobroCambio(params.prev, params.next)) {
    bloqueado = false;
    return {
      datos: applyMontoCalculadoSugeridoSiNoEditado(
        params.next,
        params.montoEditor,
        params.programaDb,
      ),
      bloqueadoManual: bloqueado,
    };
  }

  if (params.prev.montoMejoravit !== params.next.montoMejoravit) {
    return {
      datos: applyMontoCalculadoSugeridoSiNoBloqueado(
        params.next,
        params.montoEditor,
        params.programaDb,
        bloqueado,
      ),
      bloqueadoManual: bloqueado,
    };
  }

  return { datos: params.next, bloqueadoManual: bloqueado };
}

/** Aplica monto calculado sugerido si el asesor no lo bloqueó manualmente. */
export function applyMontoCalculadoSugeridoSiNoBloqueado(
  datos: ClienteDatosFormShape,
  montoEditor: number | null | undefined,
  programaDb: string | null | undefined,
  bloqueadoManual: boolean,
): ClienteDatosFormShape {
  if (bloqueadoManual) return datos;
  return applyMontoCalculadoSugeridoSiNoEditado(datos, montoEditor, programaDb);
}

export function formatMontoCalculadoSugerido(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  return String(value);
}

/** Sugiere monto calculado automático si el asesor no lo editó manualmente. */
export function applyMontoCalculadoSugeridoSiNoEditado(
  datos: ClienteDatosFormShape,
  montoEditor: number | null | undefined,
  programaDb: string | null | undefined,
): ClienteDatosFormShape {
  const pct = parsePorcentajeCobroInput(datos.porcentajeCobro);
  const auto = calcMontoCalculadoCobro(montoEditor, pct, {
    programaDb,
    montoMejoravitForm: datos.montoMejoravit,
  });
  if (auto == null) {
    return datos;
  }
  const sugerido = formatMontoCalculadoSugerido(auto);
  if (datos.montoCalculado === sugerido) return datos;
  return { ...datos, montoCalculado: sugerido };
}

/** Valor a enviar como p_monto_calculado_manual (null = usar automático en servidor). */
export function resolveMontoCalculadoManualForRpc(
  montoForm: string,
  esManual: boolean,
): number | null {
  if (!esManual) return null;
  const manual = parseMontoCalculadoInput(montoForm);
  if (manual == null || manual <= 0) return null;
  return manual;
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
