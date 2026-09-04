/**
 * Helpers compartidos para documentos opcionales asesor scoped por equipo (PDF).
 */
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
import {
  CLIENTE_BAJO_PROTESTA_DOCUMENT_CONTRACT,
  CLIENTE_BAJO_PROTESTA_DOCUMENT_TIPO,
  CLIENTE_LISTA_NOMINAL_DOCUMENT_CONTRACT,
  CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
  CLIENTE_PRESUPUESTO_DOCUMENT_CONTRACT,
  CLIENTE_PRESUPUESTO_DOCUMENT_TIPO,
  CLIENTE_SOLICITUD_CREDITO_DOCUMENT_CONTRACT,
  CLIENTE_SOLICITUD_CREDITO_DOCUMENT_TIPO,
  type IntegrationDocAsesorScopedPorEquipoTipo,
} from "./integration-docs-completos";
import { formatBytesLabel } from "./cliente-pagare";

export { formatBytesLabel };

export const SCOPED_EQUIPO_PDF_ACCEPT_ATTR = "application/pdf,.pdf";

export type ScopedEquipoDocumento = Readonly<{
  id: string;
  expedienteId: string;
  tipoDocumento: string;
  fileName: string;
  mimeType: string;
  fileSize: number | null;
  version: number;
  createdAt: string;
  createdByName: string | null;
}>;

export type ScopedEquipoDocumentoUi = Readonly<{
  tipo: IntegrationDocAsesorScopedPorEquipoTipo;
  label: string;
  uploadHint: string;
  maxBytes: number;
}>;

export const SCOPED_EQUIPO_DOCUMENTO_UI: readonly ScopedEquipoDocumentoUi[] = [
  {
    tipo: CLIENTE_SOLICITUD_CREDITO_DOCUMENT_TIPO,
    label: CLIENTE_SOLICITUD_CREDITO_DOCUMENT_CONTRACT.label,
    uploadHint:
      "Documento opcional. Sube la Solicitud de crédito en PDF (máx. 15 MB).",
    maxBytes: CLIENTE_SOLICITUD_CREDITO_DOCUMENT_CONTRACT.maxBytes,
  },
  {
    tipo: CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
    label: CLIENTE_LISTA_NOMINAL_DOCUMENT_CONTRACT.label,
    uploadHint: "Documento opcional. Sube la Lista Nominal en PDF (máx. 15 MB).",
    maxBytes: CLIENTE_LISTA_NOMINAL_DOCUMENT_CONTRACT.maxBytes,
  },
  {
    tipo: CLIENTE_BAJO_PROTESTA_DOCUMENT_TIPO,
    label: CLIENTE_BAJO_PROTESTA_DOCUMENT_CONTRACT.label,
    uploadHint: "Documento opcional. Sube Bajo Protesta en PDF (máx. 15 MB).",
    maxBytes: CLIENTE_BAJO_PROTESTA_DOCUMENT_CONTRACT.maxBytes,
  },
  {
    tipo: CLIENTE_PRESUPUESTO_DOCUMENT_TIPO,
    label: CLIENTE_PRESUPUESTO_DOCUMENT_CONTRACT.label,
    uploadHint: "Documento opcional. Sube el Presupuesto en PDF (máx. 15 MB).",
    maxBytes: CLIENTE_PRESUPUESTO_DOCUMENT_CONTRACT.maxBytes,
  },
] as const;

export function getScopedEquipoDocumentoUi(
  tipo: string,
): ScopedEquipoDocumentoUi | null {
  return SCOPED_EQUIPO_DOCUMENTO_UI.find((d) => d.tipo === tipo) ?? null;
}

/** Copy del dropzone derivado de obligatoriedad (no hardcode por tipo en el padre). */
export function resolveScopedEquipoUploadHint(params: Readonly<{
  label: string;
  esObligatorio: boolean;
  maxBytes: number;
}>): string {
  const mb = Math.max(1, Math.round(params.maxBytes / (1024 * 1024)));
  const kind = params.esObligatorio ? "obligatorio" : "opcional";
  return `Documento ${kind}. Sube ${params.label} en PDF (máx. ${mb} MB).`;
}

export function isScopedEquipoPreviewableMime(
  mime: string | null | undefined,
): boolean {
  const m = String(mime ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  return m === "application/pdf" || m === "application/x-pdf";
}

export type ValidateScopedEquipoPdfResult =
  | Readonly<{ ok: true; mime: string }>
  | Readonly<{ ok: false; error: string }>;

export function validateScopedEquipoPdfFile(
  file: File | null | undefined,
  label: string,
  maxBytes: number,
): ValidateScopedEquipoPdfResult {
  if (!file) {
    return { ok: false, error: `Selecciona un archivo para ${label}.` };
  }
  if (file.size <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `El archivo no puede superar ${maxBytes / (1024 * 1024)} MB.`,
    };
  }
  const name = String(file.name ?? "").toLowerCase();
  const mime = String(file.type ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  const looksPdf =
    mime === "application/pdf" ||
    mime === "application/x-pdf" ||
    name.endsWith(".pdf");
  if (!looksPdf) {
    return { ok: false, error: "Solo se permiten archivos PDF." };
  }
  return { ok: true, mime: "application/pdf" };
}

export function findScopedEquipoDocumentoFromList(
  list: readonly ExpedienteArchivoListItem[],
  tipo: string,
): ScopedEquipoDocumento | null {
  const row = list.find((d) => d.tipo_documento === tipo);
  if (!row) return null;
  return {
    id: row.id,
    expedienteId: row.expediente_id,
    tipoDocumento: tipo,
    fileName: row.nombre_original,
    mimeType: row.mime_type,
    fileSize: row.size_bytes,
    version: row.version,
    createdAt: row.created_at,
    createdByName: row.uploaded_by_name,
  };
}

export function sanitizeScopedEquipoDisplayName(
  name: string | null | undefined,
  fallback: string,
): string {
  const trimmed = String(name ?? "").trim();
  const noSlashes = trimmed.replace(/[/\\]+/g, "_");
  const cleaned = noSlashes.replace(/^\.+/, "").slice(0, 160);
  return cleaned || fallback;
}

/** Misma regla que Vigencia/Constancia SAT: ciclo activo. */
export function asesorPuedeEditarScopedEquipoDocumento(
  cicloEstado: string | null | undefined,
): boolean {
  const ciclo = String(cicloEstado ?? "activo")
    .trim()
    .toLowerCase();
  return ciclo === "activo";
}
