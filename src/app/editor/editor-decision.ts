import type { EditorDecision, ExpedienteMock } from "@/domain/expedientes";
import {
  editorRevisionDisplay,
  MSG_EDITOR_REPRECAL_EMPTY,
  type EditorReprecalMeta,
} from "@/domain/expedientes/editor-reprecal-read-model";
import { parseMontoAprobado } from "@/lib/monto";

export interface EditorPrecalRow {
  id: string;
  programa: string;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  asesorId: string;
  createdAt: string;
  decision: string;
  monto_aprobado: number | null;
  notas_revision: string;
  esReingreso: boolean;
  esReprecalPendiente: boolean;
  reprecalificacionPendienteId: string | null;
  reprecalResuelta: boolean;
}

export type RowSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export type RowSaveState = {
  status: RowSaveStatus;
  error?: string;
};

export function mapExpedienteToEditorRow(
  e: ExpedienteMock,
  reprecalMeta?: EditorReprecalMeta | null,
): EditorPrecalRow {
  const revision = editorRevisionDisplay(e, reprecalMeta);
  return {
    id: e.id,
    programa: e.base.programa,
    nss: e.base.nss,
    cliente_nombre: e.base.cliente_nombre,
    telefono_cliente: e.base.telefono_cliente,
    asesorId: e.base.asesorId,
    createdAt: e.base.createdAt,
    decision: revision.decision,
    monto_aprobado: revision.monto_aprobado,
    notas_revision: revision.notas_revision,
    esReingreso: Boolean(
      e.reingreso?.expedienteAnteriorId && e.reingreso?.rechazoId,
    ),
    esReprecalPendiente: revision.esReprecalPendiente,
    reprecalificacionPendienteId: e.reprecalificacionPendienteId ?? null,
    reprecalResuelta: revision.reprecalResuelta,
  };
}

export function applyResolvedReprecalToRow(
  row: EditorPrecalRow,
  payload: {
    decision: EditorDecision;
    monto_aprobado: number | null;
    notas_revision: string;
  },
): EditorPrecalRow {
  return {
    ...row,
    decision: payload.decision,
    monto_aprobado: payload.monto_aprobado,
    notas_revision: payload.notas_revision,
    esReprecalPendiente: false,
    reprecalificacionPendienteId: null,
    reprecalResuelta: true,
  };
}

export function createEditorReprecalSaveGuard(): {
  tryBegin: (expedienteId: string) => boolean;
  end: (expedienteId: string) => void;
} {
  const inFlight = new Set<string>();
  return {
    tryBegin(expedienteId: string) {
      const id = expedienteId.trim();
      if (!id || inFlight.has(id)) return false;
      inFlight.add(id);
      return true;
    },
    end(expedienteId: string) {
      inFlight.delete(expedienteId.trim());
    },
  };
}

export function buildReprecalResolutionPayload(
  montoStr: string,
  notasStr: string,
): {
  decision: EditorDecision;
  monto_aprobado: number | null;
  notas_revision: string;
} {
  const payload = buildDecisionPayload(montoStr, notasStr);
  if (payload.decision === "pendiente") {
    throw new Error(MSG_EDITOR_REPRECAL_EMPTY);
  }
  return payload;
}

export function computeDecision(
  montoStr: string,
  notasStr: string,
): EditorDecision {
  const montoTrim = (montoStr ?? "").trim();
  const notasTrim = (notasStr ?? "").trim();
  if (montoTrim !== "") {
    const num = parseMontoAprobado(montoTrim);
    if (num !== null && num > 0) return "aprobado";
  }
  if (notasTrim.length > 0) return "no_cumple";
  return "pendiente";
}

export function buildDecisionPayload(
  montoStr: string,
  notasStr: string,
): {
  decision: EditorDecision;
  monto_aprobado: number | null;
  notas_revision: string;
} {
  const montoTrim = montoStr.trim();
  const notasTrim = notasStr.trim();
  const num = montoTrim === "" ? null : parseMontoAprobado(montoTrim);

  if (montoTrim !== "" && num === null) {
    throw new Error("Formato de monto aprobado inválido.");
  }
  if (num !== null && num < 0) {
    throw new Error("El monto aprobado no puede ser negativo.");
  }

  const decision = computeDecision(montoStr, notasStr);

  if (decision === "aprobado") {
    return {
      decision,
      monto_aprobado: num,
      notas_revision: notasTrim,
    };
  }

  if (decision === "no_cumple") {
    return {
      decision,
      monto_aprobado: null,
      notas_revision: notasTrim,
    };
  }

  return {
    decision: "pendiente",
    monto_aprobado: null,
    notas_revision: "",
  };
}

export function formatMontoInputValue(monto: number | null): string {
  return monto != null ? String(monto) : "";
}

export function formatRowSaveErrorLabel(error?: string): string {
  const msg = (error ?? "").trim();
  if (!msg) return "Error";
  return msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
}

/** Limpia timers y estado UI de guardado por fila (p. ej. al refetch paginado). */
export function clearRowSaveUiState(input: {
  debounceTimers: Record<string, ReturnType<typeof setTimeout>>;
  savedClearTimers: Record<string, ReturnType<typeof setTimeout>>;
}): Record<string, RowSaveState> {
  Object.values(input.debounceTimers).forEach(clearTimeout);
  for (const key of Object.keys(input.debounceTimers)) {
    delete input.debounceTimers[key];
  }
  Object.values(input.savedClearTimers).forEach(clearTimeout);
  for (const key of Object.keys(input.savedClearTimers)) {
    delete input.savedClearTimers[key];
  }
  return {};
}
