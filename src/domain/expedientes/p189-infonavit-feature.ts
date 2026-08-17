import {
  hasCapturedInfonavitV1,
  type InfonavitClienteDatosV1,
} from "@/domain/expediente-cliente-datos/infonavit-datos";

export type P189InfonavitFeatureStatus = Readonly<{
  aplica: boolean;
  feature_active: boolean;
  legacy: boolean;
  required: boolean;
  has_complete_v1: boolean;
}>;

export const P189_INFONAVIT_FEATURE_OFF: P189InfonavitFeatureStatus = {
  aplica: false,
  feature_active: false,
  legacy: false,
  required: false,
  has_complete_v1: false,
};

export function parseP189InfonavitFeatureStatus(
  raw: unknown,
): P189InfonavitFeatureStatus {
  if (!raw || typeof raw !== "object") return P189_INFONAVIT_FEATURE_OFF;
  const o = raw as Record<string, unknown>;
  return {
    aplica: o.aplica === true,
    feature_active: o.feature_active === true,
    legacy: o.legacy === true,
    required: o.required === true,
    has_complete_v1: o.has_complete_v1 === true,
  };
}

/** Bloquear unsaved solo si el envío va a exigir/encolar snapshot. */
export function p189BlocksUnsavedClienteDatos(
  status: P189InfonavitFeatureStatus | null | undefined,
): boolean {
  if (!status) return false;
  return status.required || (status.feature_active && status.has_complete_v1);
}

/**
 * B7.1: el formulario P189 solo se muestra si es obligatorio
 * o si un legacy ON ya tiene datos.infonavit capturados.
 * FLAG OFF / legacy sin v1 / non-Mejoravit → UI pre-P189.
 */
export function shouldShowAsesorInfonavitDatosFields(input: {
  status?: P189InfonavitFeatureStatus | null;
  infonavit?: InfonavitClienteDatosV1 | null;
}): boolean {
  const status = input.status;
  if (!status) return false;
  if (status.required === true) return true;
  if (
    status.feature_active === true &&
    status.legacy === true &&
    hasCapturedInfonavitV1(input.infonavit)
  ) {
    return true;
  }
  return false;
}
