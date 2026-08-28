/** Campos Infonavit persistidos en `editor_decisions` (automatización). */
export type EditorDecisionInfonavitSource = Readonly<{
  rfc_infonavit?: string | null;
  registro_patronal_infonavit?: string | null;
  empresa_infonavit?: string | null;
  advertencia_inscripcion?: string | null;
}>;

export type ClienteDatosInfonavitAutofillShape = Readonly<{
  rfc: string;
  registroPatronal: string;
  empresa: string;
}>;

/**
 * Pre-llena RFC, registro patronal y empresa solo si el campo del formulario
 * está vacío (trim). Nunca sobrescribe valor capturado o guardado.
 */
export function applyClienteDatosInfonavitAutofill<
  T extends ClienteDatosInfonavitAutofillShape,
>(datos: T, source: EditorDecisionInfonavitSource | null | undefined): T {
  if (!source) return datos;

  const pick = (current: string, incoming: string | null | undefined): string => {
    if (String(current ?? "").trim()) return current;
    const v = String(incoming ?? "").trim();
    return v || current;
  };

  return {
    ...datos,
    rfc: pick(datos.rfc, source.rfc_infonavit),
    registroPatronal: pick(datos.registroPatronal, source.registro_patronal_infonavit),
    empresa: pick(datos.empresa, source.empresa_infonavit),
  };
}

/** Texto del banner si Infonavit reportó advertencia de inscripción. */
export function formatAdvertenciaInscripcionInfonavit(
  advertencia: string | null | undefined,
): string | null {
  const msg = String(advertencia ?? "").trim();
  if (!msg) return null;
  return `Infonavit reporta: ${msg}`;
}
