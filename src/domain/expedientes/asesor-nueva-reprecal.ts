import {
  validateGateForDetalleReprecal,
  type ReprecalUiMode,
} from "./asesor-reprecal-flow";
import { mapProgramaDbToUi } from "./map-programa";
import {
  isNssPrecalGateBlocked,
  type NssPrecalGateResult,
} from "./nss-precal-gate";
import { newReprecalIdempotencyKey } from "./reprecal-idempotency";
import type { CreateExpedienteInput } from "./create-expediente.input";
import type { IniciarReprecalificacionInput } from "./nss-precal-gate";

export const MSG_NUEVA_REPRECAL_TITLE = "Este NSS ya está en tus expedientes";

export const MSG_NUEVA_REPRECAL_BODY =
  "Ya tienes un expediente activo para este NSS. ¿Quieres volver a enviar la precalificación? Se utilizará el mismo expediente y no se creará uno nuevo.";

export const MSG_NUEVA_REPRECAL_SAME_Q =
  "Ya tienes este NSS en uno de tus expedientes. ¿Quieres volver a enviar la precalificación?";

export const MSG_NUEVA_REPRECAL_PENDING =
  "Ya existe una precalificación en revisión. Si continúas, se actualizarán los datos de esa solicitud pendiente.";

export const MSG_NUEVA_REPRECAL_PENDING_SHORT =
  "Ya existe una precalificación en revisión. Si continúas, actualizaremos esa solicitud.";

export const MSG_NUEVA_REPRECAL_SUCCESS =
  "Precalificación enviada nuevamente al Editor.";

export const MSG_NUEVA_REPRECAL_CHANGE_SUCCESS =
  "El cambio de programa se envió al Editor. El programa vigente no cambiará hasta que sea aprobado.";

export const MSG_NUEVA_REPRECAL_MISSING_EXPEDIENTE =
  "No se pudo identificar el expediente de este NSS. Recarga la página o ábrelo desde tu bandeja.";

export type NuevaAfterGateDecision =
  | { action: "blocked"; message: string }
  | { action: "create" }
  | { action: "confirm_same"; expedienteId: string }
  | { action: "confirm_change"; expedienteId: string }
  | { action: "confirm_missing_expediente"; message: string };

export function decideNuevaAfterGate(
  gate: NssPrecalGateResult,
): NuevaAfterGateDecision {
  if (isNssPrecalGateBlocked(gate.status)) {
    return { action: "blocked", message: gate.message };
  }
  if (gate.status === "ok_create") {
    return { action: "create" };
  }
  const expedienteId = String(gate.expediente_id ?? "").trim();
  if (gate.status === "reprecal_own_mesa") {
    if (!expedienteId) {
      return {
        action: "confirm_missing_expediente",
        message: MSG_NUEVA_REPRECAL_MISSING_EXPEDIENTE,
      };
    }
    return { action: "confirm_same", expedienteId };
  }
  if (gate.status === "reprecal_change_programa") {
    if (!expedienteId) {
      return {
        action: "confirm_missing_expediente",
        message: MSG_NUEVA_REPRECAL_MISSING_EXPEDIENTE,
      };
    }
    return { action: "confirm_change", expedienteId };
  }
  return { action: "blocked", message: gate.message };
}

export function formatNuevaProgramaLabel(raw: string | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t) return "—";
  return mapProgramaDbToUi(t);
}

export function validateNuevaConfirmBeforeRpc(input: {
  mode: ReprecalUiMode;
  firstExpedienteId: string;
  secondGate: NssPrecalGateResult;
}): string | null {
  return validateGateForDetalleReprecal({
    mode: input.mode,
    gate: input.secondGate,
    expedienteId: input.firstExpedienteId,
  });
}

export type NuevaReprecalSubmitGuard = {
  begin: () => boolean;
  end: () => void;
  getIdempotencyKey: () => string;
  clearKey: () => void;
  isInFlight: () => boolean;
};

export function createNuevaReprecalSubmitGuard(): NuevaReprecalSubmitGuard {
  let inFlight = false;
  let key: string | null = null;
  return {
    begin() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    end() {
      inFlight = false;
    },
    getIdempotencyKey() {
      if (!key) key = newReprecalIdempotencyKey();
      return key;
    },
    clearKey() {
      key = null;
    },
    isInFlight() {
      return inFlight;
    },
  };
}

export function iniciarPayloadFromNuevaForm(
  input: CreateExpedienteInput,
  idempotencyKey: string,
): IniciarReprecalificacionInput {
  return {
    programa: input.programa,
    nss: input.nss,
    cliente_nombre: input.cliente_nombre,
    telefono_cliente: input.telefono_cliente,
    direccion_opcional: input.direccion_opcional,
    idempotency_key: idempotencyKey,
  };
}

export type ExecuteNuevaReprecalResult =
  | { ok: true; expedienteId: string }
  | { ok: false; reason: "in_flight" }
  | { ok: false; reason: "gate"; message: string }
  | { ok: false; reason: "rpc"; error: unknown };

export async function executeNuevaReprecalConfirm(input: {
  guard: NuevaReprecalSubmitGuard;
  firstExpedienteId: string;
  mode: ReprecalUiMode;
  form: CreateExpedienteInput;
  lookup: (
    nss: string,
    programa: CreateExpedienteInput["programa"],
  ) => Promise<NssPrecalGateResult>;
  iniciar: (
    payload: IniciarReprecalificacionInput,
  ) => Promise<{ expediente_id?: string } | unknown>;
}): Promise<ExecuteNuevaReprecalResult> {
  if (!input.guard.begin()) {
    return { ok: false, reason: "in_flight" };
  }
  try {
    const secondGate = await input.lookup(input.form.nss, input.form.programa);
    const gateErr = validateNuevaConfirmBeforeRpc({
      mode: input.mode,
      firstExpedienteId: input.firstExpedienteId,
      secondGate,
    });
    if (gateErr) {
      return { ok: false, reason: "gate", message: gateErr };
    }
    const idempotencyKey = input.guard.getIdempotencyKey();
    await input.iniciar(
      iniciarPayloadFromNuevaForm(input.form, idempotencyKey),
    );
    input.guard.clearKey();
    return { ok: true, expedienteId: input.firstExpedienteId };
  } catch (error) {
    return { ok: false, reason: "rpc", error };
  } finally {
    input.guard.end();
  }
}

export function nuevaExpedienteDetallePath(expedienteId: string): string {
  return `/asesor/expediente/${expedienteId}`;
}
