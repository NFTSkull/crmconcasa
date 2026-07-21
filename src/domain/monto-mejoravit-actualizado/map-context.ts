import type {
  ActualizarMontoMejoravitMesaResult,
  ExpedienteMontoMejoravitContext,
  MontoMejoravitHistorialEntry,
  MontoMejoravitUltimaActualizacion,
} from "./types";

export class MontoMejoravitContextParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MontoMejoravitContextParseError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseNullableNumber(
  value: unknown,
  field: string,
): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new MontoMejoravitContextParseError(
    `Campo inválido (${field}): se esperaba un número.`,
  );
}

function parseRequiredNumber(value: unknown, field: string): number {
  const n = parseNullableNumber(value, field);
  if (n == null) {
    throw new MontoMejoravitContextParseError(
      `Campo obligatorio ausente o inválido (${field}).`,
    );
  }
  return n;
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    return String(value);
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : value;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MontoMejoravitContextParseError(
      `Campo obligatorio ausente o inválido (${field}).`,
    );
  }
  return value;
}

function parseHistorialEntry(raw: unknown): MontoMejoravitHistorialEntry {
  const row = asRecord(raw);
  if (!row) {
    throw new MontoMejoravitContextParseError(
      "Entrada de historial con formato inválido.",
    );
  }
  return {
    id: parseRequiredString(row.id, "historial.id"),
    montoAnterior: parseRequiredNumber(row.monto_anterior, "historial.monto_anterior"),
    montoNuevo: parseRequiredNumber(row.monto_nuevo, "historial.monto_nuevo"),
    diferencia: parseRequiredNumber(row.diferencia, "historial.diferencia"),
    porcentajeCobro: parseRequiredNumber(
      row.porcentaje_cobro,
      "historial.porcentaje_cobro",
    ),
    montoCobroAnterior: parseNullableNumber(
      row.monto_cobro_anterior,
      "historial.monto_cobro_anterior",
    ),
    montoCobroNuevo: parseRequiredNumber(
      row.monto_cobro_nuevo,
      "historial.monto_cobro_nuevo",
    ),
    motivo: parseRequiredString(row.motivo, "historial.motivo"),
    createdAt: parseRequiredString(row.created_at, "historial.created_at"),
    createdBy: parseNullableString(row.created_by),
    createdByName: parseNullableString(row.created_by_name),
  };
}

function parseUltima(
  raw: unknown,
): MontoMejoravitUltimaActualizacion | null {
  if (raw == null) return null;
  const row = asRecord(raw);
  if (!row) {
    throw new MontoMejoravitContextParseError(
      "Última actualización con formato inválido.",
    );
  }
  return {
    montoNuevo: parseRequiredNumber(row.monto_nuevo, "ultima.monto_nuevo"),
    motivo: parseRequiredString(row.motivo, "ultima.motivo"),
    updatedAt: parseRequiredString(row.updated_at, "ultima.updated_at"),
    updatedBy: parseNullableString(row.updated_by),
    updatedByName: parseNullableString(row.updated_by_name),
  };
}

/** Normaliza el JSONB de `get_expediente_monto_mejoravit_context`. */
export function mapExpedienteMontoMejoravitContext(
  raw: unknown,
): ExpedienteMontoMejoravitContext {
  const row = asRecord(raw);
  if (!row) {
    throw new MontoMejoravitContextParseError(
      "Respuesta de contexto de monto Mejoravit inválida.",
    );
  }

  const historialRaw = row.historial;
  let historial: MontoMejoravitHistorialEntry[] = [];
  if (historialRaw == null) {
    historial = [];
  } else if (!Array.isArray(historialRaw)) {
    throw new MontoMejoravitContextParseError(
      "Historial de monto Mejoravit con formato inválido.",
    );
  } else {
    historial = historialRaw.map(parseHistorialEntry);
  }

  const cargoFijo = parseRequiredNumber(row.cargo_fijo, "cargo_fijo");
  if (cargoFijo !== 3000) {
    throw new MontoMejoravitContextParseError(
      "Cargo fijo inesperado en el contexto de monto Mejoravit.",
    );
  }

  return {
    expedienteId: parseRequiredString(row.expediente_id, "expediente_id"),
    montoAprobadoEditor: parseNullableNumber(
      row.monto_aprobado_editor,
      "monto_aprobado_editor",
    ),
    montoSnapshotPrimeraAprobacion: parseNullableNumber(
      row.monto_snapshot_primera_aprobacion,
      "monto_snapshot_primera_aprobacion",
    ),
    montoMejoravitDatosGenerales: parseNullableNumber(
      row.monto_mejoravit_datos_generales,
      "monto_mejoravit_datos_generales",
    ),
    montoMejoravitActualizado: parseNullableNumber(
      row.monto_mejoravit_actualizado,
      "monto_mejoravit_actualizado",
    ),
    montoOperativoVigente: parseNullableNumber(
      row.monto_operativo_vigente,
      "monto_operativo_vigente",
    ),
    montoOriginalOperativo: parseNullableNumber(
      row.monto_original_operativo,
      "monto_original_operativo",
    ),
    porcentajeCobro: parseNullableNumber(
      row.porcentaje_cobro,
      "porcentaje_cobro",
    ),
    cargoFijo,
    montoCalculado: parseNullableNumber(row.monto_calculado, "monto_calculado"),
    ultimaActualizacion: parseUltima(row.ultima_actualizacion),
    historial,
    canUpdate: row.can_update === true,
  };
}

/** Normaliza el JSONB de `mesa_actualizar_monto_mejoravit`. */
export function mapActualizarMontoMejoravitResult(
  raw: unknown,
): ActualizarMontoMejoravitMesaResult {
  const row = asRecord(raw);
  if (!row) {
    throw new MontoMejoravitContextParseError(
      "Respuesta de actualización de monto Mejoravit inválida.",
    );
  }
  if (row.ok !== true) {
    throw new MontoMejoravitContextParseError(
      "La actualización de monto Mejoravit no se completó.",
    );
  }
  return {
    ok: true,
    expedienteId: parseRequiredString(row.expediente_id, "expediente_id"),
    montoOriginalOperativo: parseRequiredNumber(
      row.monto_original_operativo,
      "monto_original_operativo",
    ),
    montoAnterior: parseRequiredNumber(row.monto_anterior, "monto_anterior"),
    montoNuevo: parseRequiredNumber(row.monto_nuevo, "monto_nuevo"),
    diferencia: parseRequiredNumber(row.diferencia, "diferencia"),
    porcentajeCobro: parseRequiredNumber(
      row.porcentaje_cobro,
      "porcentaje_cobro",
    ),
    montoCobroAnterior: parseNullableNumber(
      row.monto_cobro_anterior,
      "monto_cobro_anterior",
    ),
    montoCobroNuevo: parseRequiredNumber(
      row.monto_cobro_nuevo,
      "monto_cobro_nuevo",
    ),
    motivo: parseRequiredString(row.motivo, "motivo"),
    updatedBy: parseNullableString(row.updated_by),
    updatedAt: parseNullableString(row.updated_at),
  };
}
