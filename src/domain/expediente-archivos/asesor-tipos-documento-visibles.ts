/**
 * RPC UI: tipos scoped visibles para el asesor autenticado.
 * Fail-closed: cualquier error / payload inválido → [].
 */
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO,
  type IntegrationDocAsesorScopedPorEquipoTipo,
} from "./integration-docs-completos";

export function parseAsesorTiposDocumentoVisibles(
  raw: unknown,
): readonly IntegrationDocAsesorScopedPorEquipoTipo[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO);
  const out: IntegrationDocAsesorScopedPorEquipoTipo[] = [];
  for (const item of raw) {
    const t = String(item ?? "").trim();
    if (!allowed.has(t)) continue;
    if (!out.includes(t as IntegrationDocAsesorScopedPorEquipoTipo)) {
      out.push(t as IntegrationDocAsesorScopedPorEquipoTipo);
    }
  }
  return out;
}

export function shouldMountAsesorScopedEquipoDocumentoSection(params: Readonly<{
  expedienteId: string | null | undefined;
  tipo: string;
  tiposVisibles: readonly string[] | null | undefined;
  /**
   * Si el tipo ya está en el checklist obligatorio (p. ej. externos 8),
   * no montar la sección dedicada → evita duplicados.
   */
  tiposYaEnChecklistObligatorios?: readonly string[] | null | undefined;
}>): boolean {
  if (!String(params.expedienteId ?? "").trim()) return false;
  const visibles = params.tiposVisibles ?? [];
  if (!visibles.includes(params.tipo)) return false;
  const enChecklist = params.tiposYaEnChecklistObligatorios ?? [];
  if (enChecklist.includes(params.tipo)) return false;
  return true;
}

/**
 * Llama `asesor_tipos_documento_visibles`. Nunca lanza: fail-closed → [].
 */
export async function fetchAsesorTiposDocumentoVisibles(): Promise<
  readonly IntegrationDocAsesorScopedPorEquipoTipo[]
> {
  try {
    if (!isSupabaseConfigured() || !supabaseBrowser) return [];
    const { data, error } = await supabaseBrowser.rpc(
      "asesor_tipos_documento_visibles",
    );
    if (error) return [];
    return parseAsesorTiposDocumentoVisibles(data);
  } catch {
    return [];
  }
}
