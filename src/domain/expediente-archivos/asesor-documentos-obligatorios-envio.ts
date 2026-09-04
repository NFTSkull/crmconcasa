/**
 * RPC UI: documentos obligatorios de envío por dueño del expediente.
 * Fail-closed estricto → copia de los 4 clásicos (nunca parcial).
 */
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO } from "./integration-docs-completos";

/** Espejo exacto del paquete externos Parte A (7, sin INE reverso). */
export const INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS = [
  "cliente_ine_frente",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
  "cliente_solicitud_credito",
  "cliente_lista_nominal",
  "cliente_bajo_protesta",
  "cliente_presupuesto",
] as const;

export type IntegrationDocAsesorEnvioExternoTipo =
  (typeof INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS)[number];

export type IntegrationDocAsesorEnvioObligatorioTipo =
  | (typeof INTEGRATION_DOC_TIPOS_ASESOR_ENVIO)[number]
  | IntegrationDocAsesorEnvioExternoTipo;

const KNOWN = new Set<string>([
  ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
]);

function copyClasicos(): IntegrationDocAsesorEnvioObligatorioTipo[] {
  return [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO];
}

function sameExactSet(
  raw: readonly string[],
  expected: readonly string[],
): boolean {
  if (raw.length !== expected.length) return false;
  const seen = new Set<string>();
  for (const t of raw) {
    if (seen.has(t)) return false;
    seen.add(t);
  }
  if (seen.size !== expected.length) return false;
  return expected.every((t) => seen.has(t));
}

/**
 * Acepta ÚNICAMENTE el set exacto de 4 clásicos o el de 7 externos.
 * Cualquier basura / parcial / desconocido / duplicado → 4 clásicos.
 */
export function parseAsesorDocumentosObligatoriosEnvio(
  raw: unknown,
): readonly IntegrationDocAsesorEnvioObligatorioTipo[] {
  if (!Array.isArray(raw)) return copyClasicos();
  if (raw.length === 0) return copyClasicos();

  const tipos: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return copyClasicos();
    const t = item.trim();
    if (!t || !KNOWN.has(t)) return copyClasicos();
    tipos.push(t);
  }

  if (sameExactSet(tipos, INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS)) {
    return [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS];
  }
  if (sameExactSet(tipos, INTEGRATION_DOC_TIPOS_ASESOR_ENVIO)) {
    return [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO];
  }
  return copyClasicos();
}

/**
 * Llama `asesor_documentos_obligatorios_envio`.
 * `asesorId` = dueño del expediente; omitido → JWT.
 * Nunca lanza: fail-closed → 4 clásicos.
 */
export async function fetchAsesorDocumentosObligatoriosEnvio(
  asesorId?: string | null,
): Promise<readonly IntegrationDocAsesorEnvioObligatorioTipo[]> {
  try {
    if (!isSupabaseConfigured() || !supabaseBrowser) return copyClasicos();

    const id = String(asesorId ?? "").trim();
    const hasId =
      id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      );

    const { data, error } = hasId
      ? await supabaseBrowser.rpc("asesor_documentos_obligatorios_envio", {
          p_asesor_id: id,
        })
      : await supabaseBrowser.rpc("asesor_documentos_obligatorios_envio");
    if (error) return copyClasicos();
    return parseAsesorDocumentosObligatoriosEnvio(data);
  } catch {
    return copyClasicos();
  }
}
