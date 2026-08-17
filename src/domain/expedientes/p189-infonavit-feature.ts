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

/** P189 B8: el asesor nunca tiene gate unsaved por INFONAVIT. */
export function p189BlocksUnsavedClienteDatos(
  _status?: P189InfonavitFeatureStatus | null | undefined,
): boolean {
  return false;
}

/** P189 B8: UI asesor siempre pre-P189 (sin campos INFONAVIT). */
export function shouldShowAsesorInfonavitDatosFields(_input?: {
  status?: P189InfonavitFeatureStatus | null;
  infonavit?: unknown;
}): boolean {
  return false;
}
